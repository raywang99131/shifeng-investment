import { publishReadyDates } from './publisher';
import { CollectorRepository } from './repository';
import { FixedSourceError } from './sources/http';
import { fetchIceObservations } from './sources/ice';
import { fetchTreasuryCurve } from './sources/treasury';
import type { CollectorRunResult, Env, PartialDate, TriggerKind } from './types';

export const COLLECTOR_OBJECT_NAME = 'ice-cds-global-v1';

const stableError = (error: unknown): { code: string; message: string } => {
  if (error instanceof FixedSourceError) return { code: error.code, message: error.message };
  return { code: 'COLLECTION_FAILED', message: 'Collection failed' };
};

const createRunId = (now: Date): string => `collector-${now.getTime()}-${crypto.randomUUID()}`;

const candidateDates = (rows: Array<{ clearingDate: string }>): string[] => (
  [...new Set(rows.map((row) => row.clearingDate))].sort()
);

const mergePartialDates = (partialDates: PartialDate[]): PartialDate[] => {
  const merged = new Map<string, PartialDate>();
  for (const row of partialDates) {
    const existing = merged.get(row.clearingDate);
    if (!existing) {
      merged.set(row.clearingDate, { ...row, missingCompanies: [...row.missingCompanies] });
      continue;
    }
    merged.set(row.clearingDate, {
      clearingDate: row.clearingDate,
      missingCompanies: [...new Set([...existing.missingCompanies, ...row.missingCompanies])],
      reason: row.reason ?? existing.reason,
    });
  }
  return [...merged.values()].sort((left, right) => left.clearingDate.localeCompare(right.clearingDate));
};

export async function collectOnce(input: {
  env: Env;
  triggerKind: Extract<TriggerKind, 'alarm' | 'cron' | 'manual'>;
  now: Date;
  fetchImpl?: typeof fetch;
  nextAlarmAt?: string | null;
  scheduleRetry?: () => Promise<string>;
}): Promise<CollectorRunResult> {
  const repository = new CollectorRepository(input.env.DB);
  const runId = createRunId(input.now);
  const at = input.now.toISOString();
  await repository.startRun({
    runId,
    triggerKind: input.triggerKind,
    startedAt: at,
    candidateDates: [],
    nextAlarmAt: input.nextAlarmAt,
  });
  let rawWriteCount = 0;

  try {
    const ice = await fetchIceObservations(input.fetchImpl ?? fetch, input.now);
    const sourcePartialDates = ice.partialDates.map((row) => ({ ...row }));
    await repository.updateRunCandidates(runId, candidateDates([...ice.rows, ...sourcePartialDates]));
    const raw = await repository.upsertIceObservations(ice.rows);
    rawWriteCount = raw.inserted;
    const publication = await publishReadyDates({
      repository,
      fetchTreasuryCurve: (clearingDate) => fetchTreasuryCurve(input.fetchImpl ?? fetch, clearingDate, input.now),
      now: input.now,
    });
    const publishedDates = publication.published.map((batch) => batch.clearingDate);
    const partialDates = mergePartialDates([...sourcePartialDates, ...publication.partial]);
    const status = partialDates.length === 0 ? 'success' : 'partial';
    await repository.finishRun({
      runId,
      finishedAt: at,
      status,
      sourceStatus: 'ok',
      rawWriteCount,
      publishedDates,
      nextAlarmAt: input.nextAlarmAt,
    });
    await repository.recordCollectionSuccess({
      at,
      lastPublishedDate: publishedDates.at(-1) ?? null,
      nextAlarmAt: input.nextAlarmAt,
      recordAlarmAt: input.triggerKind === 'alarm',
    });
    return { runId, rawWriteCount, publishedDates, partialDates };
  } catch (error) {
    const safeError = stableError(error);
    let retryAlarmAt = input.nextAlarmAt;
    if (input.scheduleRetry) {
      try {
        retryAlarmAt = await input.scheduleRetry();
      } catch {
        // The regular successor was scheduled before source I/O. Preserve the
        // original collection error if a replacement retry alarm cannot be set.
      }
    }
    await repository.finishRun({
      runId,
      finishedAt: at,
      status: 'failed',
      sourceStatus: 'failed',
      rawWriteCount,
      publishedDates: [],
      errorCode: safeError.code,
      errorMessage: safeError.message,
      nextAlarmAt: retryAlarmAt,
    });
    await repository.recordCollectionFailure({
      at, nextAlarmAt: retryAlarmAt, recordAlarmAt: input.triggerKind === 'alarm',
    });
    throw error;
  }
}
