import { publishReadyDates } from './publisher';
import { CollectorRepository } from './repository';
import { FixedSourceError } from './sources/http';
import { fetchIceObservations } from './sources/ice';
import { fetchTreasuryCurve } from './sources/treasury';
import type { CollectorRunResult, Env, TriggerKind } from './types';

export const COLLECTOR_OBJECT_NAME = 'ice-cds-global-v1';

const stableError = (error: unknown): { code: string; message: string } => {
  if (error instanceof FixedSourceError) return { code: error.code, message: error.message };
  return { code: 'COLLECTION_FAILED', message: 'Collection failed' };
};

const createRunId = (now: Date): string => `collector-${now.getTime()}-${crypto.randomUUID()}`;

export async function collectOnce(input: {
  env: Env;
  triggerKind: Extract<TriggerKind, 'alarm' | 'cron' | 'manual'>;
  now: Date;
  fetchImpl?: typeof fetch;
  nextAlarmAt?: string | null;
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
    const raw = await repository.upsertIceObservations(ice.rows);
    rawWriteCount = raw.inserted;
    const publication = await publishReadyDates({
      repository,
      fetchTreasuryCurve: (clearingDate) => fetchTreasuryCurve(input.fetchImpl ?? fetch, clearingDate, input.now),
      now: input.now,
    });
    const publishedDates = publication.published.map((batch) => batch.clearingDate);
    const partialDates = [...ice.partialDates, ...publication.partial];
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
    });
    return { runId, rawWriteCount, publishedDates, partialDates: publication.partial };
  } catch (error) {
    const safeError = stableError(error);
    await repository.finishRun({
      runId,
      finishedAt: at,
      status: 'failed',
      sourceStatus: 'failed',
      rawWriteCount,
      publishedDates: [],
      errorCode: safeError.code,
      errorMessage: safeError.message,
      nextAlarmAt: input.nextAlarmAt,
    });
    await repository.recordCollectionFailure({ at, nextAlarmAt: input.nextAlarmAt });
    throw error;
  }
}
