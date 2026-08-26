import { parseIceInstrumentName } from './domain/contracts';
import { TRACKED_COMPANIES } from './domain/registry';
import { cleanPriceToParSpread } from './domain/spread';
import { CollectorRepository } from './repository';
import { FixedSourceError } from './sources/http';
import type { DerivedSpread, PartialDate, PublishedBatch, StoredDerivedSpread, TreasuryCurve } from './types';

const PRICE_RESIDUAL_LIMIT = 0.005;
const RECOVERY_RATE = 0.4;

const sha256Prefix = async (value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
};

export async function createBatchId(clearingDate: string, revision: number, spreadRevisionIds: readonly number[]): Promise<string> {
  return `cds-${clearingDate}-${revision}-${await sha256Prefix({ clearingDate, revision, spreadRevisionIds })}`;
}

const sameInputSet = (stored: StoredDerivedSpread[], published: Map<string, number> | null): boolean => (
  published !== null
  && stored.length === TRACKED_COMPANIES.length
  && TRACKED_COMPANIES.every((company) => published.get(company) === stored.find((row) => row.company === company)?.spreadRevisionId)
);

const partial = (clearingDate: string, missingCompanies: PartialDate['missingCompanies'], reason?: PartialDate['reason']): PartialDate => (
  reason === undefined ? { clearingDate, missingCompanies } : { clearingDate, missingCompanies, reason }
);

export async function publishReadyDates(input: {
  repository: CollectorRepository;
  fetchTreasuryCurve: (clearingDate: string) => Promise<TreasuryCurve>;
  now: Date;
}): Promise<{ published: PublishedBatch[]; partial: PartialDate[] }> {
  const published: PublishedBatch[] = [];
  const partialDates: PartialDate[] = [];

  for (const clearingDate of await input.repository.listObservedDates()) {
    // Capture the CAS baseline before reading any ICE/Treasury input. This makes the
    // expected pointer cover the entire snapshot, calculation, and publication window.
    const expectedCurrentBatchId = await input.repository.currentPublishedBatchId(clearingDate);
    const observations = await input.repository.getCurrentObservations(clearingDate);
    const byCompany = new Map(observations.map((observation) => [observation.company, observation]));
    const missingCompanies = TRACKED_COMPANIES.filter((company) => !byCompany.has(company));
    if (missingCompanies.length > 0) {
      partialDates.push(partial(clearingDate, missingCompanies));
      continue;
    }

    let curve: TreasuryCurve;
    try {
      curve = await input.fetchTreasuryCurve(clearingDate);
    } catch (error) {
      if (error instanceof FixedSourceError && error.code === 'TREASURY_CURVE_UNAVAILABLE') {
        partialDates.push(partial(clearingDate, [], 'treasury-curve-unavailable'));
        continue;
      }
      throw error;
    }
    if (curve.asOf > clearingDate) {
      partialDates.push(partial(clearingDate, [], 'treasury-curve-after-clearing-date'));
      continue;
    }

    await input.repository.upsertTreasuryCurve(curve);
    let derived: DerivedSpread[];
    try {
      derived = TRACKED_COMPANIES.map((company) => {
        const observation = byCompany.get(company)!;
        const contract = parseIceInstrumentName(observation.instrumentName);
        const result = cleanPriceToParSpread({
          couponBp: observation.couponBp,
          cleanPrice: observation.eodPrice,
          clearingDate,
          maturityDate: contract.maturityDate,
          recoveryRate: RECOVERY_RATE,
          discountCurve: curve,
        });
        return {
          clearingDate,
          company,
          iceRevisionId: observation.revisionId,
          curveId: curve.curveId,
          instrumentName: observation.instrumentName,
          maturityDate: contract.maturityDate,
          eodPrice: observation.eodPrice,
          couponBp: observation.couponBp,
          spreadBp: result.spreadBp,
          roundTripPrice: result.roundTripPrice,
          priceResidual: result.priceResidual,
          hazardRate: result.hazardRate,
          recoveryRate: result.recoveryRate,
          modelVersion: result.modelVersion,
          qualityStatus: result.priceResidual <= PRICE_RESIDUAL_LIMIT ? 'model-derived' : 'price-residual-exceeded',
          createdAt: input.now.toISOString(),
        };
      });
    } catch {
      partialDates.push(partial(clearingDate, [], 'model-calculation-failed'));
      continue;
    }
    if (derived.some((row) => row.priceResidual > PRICE_RESIDUAL_LIMIT)) {
      partialDates.push(partial(clearingDate, [], 'price-residual-exceeded'));
      continue;
    }

    const stored = await input.repository.saveSpreadRevisions(derived);
    const spreadRevisionIds = TRACKED_COMPANIES.map((company) => stored.find((row) => row.company === company)!.spreadRevisionId);
    const current = await input.repository.currentPublishedSpreadRevisionIds(clearingDate);
    if (sameInputSet(stored, current)) continue;

    const revision = await input.repository.nextBatchRevision(clearingDate);
    const outcome = await input.repository.compareAndPublishBatch({
      batchId: await createBatchId(clearingDate, revision, spreadRevisionIds),
      clearingDate,
      revision,
      publishedAt: input.now.toISOString(),
      sourceKind: 'ice_eod_isda',
      qualityStatus: 'model-derived',
      rows: TRACKED_COMPANIES.map((company, index) => ({ company, spreadRevisionId: spreadRevisionIds[index] })),
      expectedCurrentBatchId,
    });
    if (outcome.status === 'published') {
      published.push(outcome.batch);
    } else {
      // Do not retry with the in-memory ICE/curve snapshot: another input won this
      // revision and the next collection cycle must re-read both authoritative sources.
      partialDates.push(partial(clearingDate, [], 'publish-race-retry'));
    }
  }

  return { published, partial: partialDates };
}
