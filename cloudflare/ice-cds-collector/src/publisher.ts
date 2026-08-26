import { parseIceInstrumentName } from './domain/contracts';
import { TRACKED_COMPANIES } from './domain/registry';
import { cleanPriceToParSpread } from './domain/spread';
import { CollectorRepository } from './repository';
import type { DerivedSpread, PartialDate, PublishedBatch, StoredDerivedSpread, TreasuryCurve } from './types';

const PRICE_RESIDUAL_LIMIT = 0.005;
const RECOVERY_RATE = 0.4;

const sha256Prefix = async (value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
};

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
    const observations = await input.repository.getCurrentObservations(clearingDate);
    const byCompany = new Map(observations.map((observation) => [observation.company, observation]));
    const missingCompanies = TRACKED_COMPANIES.filter((company) => !byCompany.has(company));
    if (missingCompanies.length > 0) {
      partialDates.push(partial(clearingDate, missingCompanies));
      continue;
    }

    const curve = await input.fetchTreasuryCurve(clearingDate);
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
    const current = await input.repository.currentPublishedSpreadRevisionIds(clearingDate);
    if (sameInputSet(stored, current)) continue;

    const revision = await input.repository.nextBatchRevision(clearingDate);
    const spreadRevisionIds = TRACKED_COMPANIES.map((company) => stored.find((row) => row.company === company)!.spreadRevisionId);
    const batchId = `cds-${clearingDate}-${revision}-${await sha256Prefix({ clearingDate, revision, spreadRevisionIds })}`;
    const batch = await input.repository.publishBatch({
      batchId,
      clearingDate,
      revision,
      publishedAt: input.now.toISOString(),
      sourceKind: 'ice_eod_isda',
      qualityStatus: 'model-derived',
      rows: TRACKED_COMPANIES.map((company, index) => ({ company, spreadRevisionId: spreadRevisionIds[index] })),
    });
    // A concurrent replay returns the same canonical batch. Only report a newly-current revision.
    if ((await input.repository.currentPublishedSpreadRevisionIds(clearingDate))?.size === TRACKED_COMPANIES.length) {
      const alreadyReported = published.some((item) => item.batchId === batch.batchId);
      if (!alreadyReported) published.push(batch);
    }
  }

  return { published, partial: partialDates };
}
