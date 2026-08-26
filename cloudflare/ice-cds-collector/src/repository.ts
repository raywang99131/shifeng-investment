import type {
  CollectorHealth,
  Company,
  CompareAndPublishBatchInput,
  CompareAndPublishBatchResult,
  DerivedSpread,
  ExportPage,
  ExportQuery,
  HistoryPage,
  HistoryQuery,
  IceObservation,
  PublishedBatch,
  PublishBatchInput,
  RunFinish,
  RunStart,
  StoredDerivedSpread,
  StoredIceObservation,
  TreasuryCurve,
} from './types';
import { TRACKED_COMPANIES } from './domain/registry';
import { isCollectorStale } from './usBusinessDays';

type IceRevisionRow = {
  revision_id: number;
  clearing_date: string;
  company: string;
  ice_name: string;
  instrument_name: string;
  eod_price: number;
  coupon_bp: number;
  payload_hash: string;
  retrieved_at: string;
  source_url: string;
};

type SpreadRevisionRow = {
  spread_revision_id: number;
  clearing_date: string;
  company: string;
  ice_revision_id: number;
  curve_id: string;
  instrument_name: string;
  maturity_date: string;
  eod_price: number;
  coupon_bp: number;
  spread_bp: number;
  round_trip_price: number;
  price_residual: number;
  hazard_rate: number;
  recovery_rate: number;
  model_version: string;
  quality_status: string;
  created_at: string;
};

type BatchRow = {
  batch_id: string;
  clearing_date: string;
  revision: number;
  published_at: string;
  source_kind: string;
  quality_status: string;
};

const toStoredIceObservation = (row: IceRevisionRow): StoredIceObservation => ({
  revisionId: row.revision_id,
  clearingDate: row.clearing_date,
  company: row.company as Company,
  iceName: row.ice_name,
  instrumentName: row.instrument_name,
  eodPrice: row.eod_price,
  couponBp: row.coupon_bp,
  payloadHash: row.payload_hash,
  retrievedAt: row.retrieved_at,
  sourceUrl: row.source_url,
});

const toStoredDerivedSpread = (row: SpreadRevisionRow): StoredDerivedSpread => ({
  spreadRevisionId: row.spread_revision_id,
  clearingDate: row.clearing_date,
  company: row.company as Company,
  iceRevisionId: row.ice_revision_id,
  curveId: row.curve_id,
  instrumentName: row.instrument_name,
  maturityDate: row.maturity_date,
  eodPrice: row.eod_price,
  couponBp: row.coupon_bp,
  spreadBp: row.spread_bp,
  roundTripPrice: row.round_trip_price,
  priceResidual: row.price_residual,
  hazardRate: row.hazard_rate,
  recoveryRate: row.recovery_rate,
  modelVersion: row.model_version,
  qualityStatus: row.quality_status,
  createdAt: row.created_at,
});

const toPublishedBatch = (row: BatchRow): PublishedBatch => ({
  batchId: row.batch_id,
  clearingDate: row.clearing_date,
  revision: row.revision,
  publishedAt: row.published_at,
  sourceKind: row.source_kind,
  qualityStatus: row.quality_status,
});

const encodeHistoryCursor = (batch: PublishedBatch): string => (
  `${batch.clearingDate}|${batch.revision}`
);

const decodeHistoryCursor = (cursor: string | null | undefined): {
  clearingDate: string;
  revision: number;
} | null => {
  if (cursor === null || cursor === undefined) return null;
  const separator = cursor.lastIndexOf('|');
  const clearingDate = cursor.slice(0, separator);
  const revision = Number(cursor.slice(separator + 1));
  if (separator <= 0 || !Number.isInteger(revision) || revision < 0) {
    throw new Error('Invalid history cursor');
  }
  return { clearingDate, revision };
};

export class CollectorRepository {
  constructor(private readonly db: D1Database) {}

  async startRun(input: RunStart): Promise<void> {
    await this.db.prepare(`
      INSERT INTO collector_runs (
        run_id, trigger_kind, started_at, status, candidate_dates_json, next_alarm_at
      ) VALUES (?, ?, ?, 'running', ?, ?)
    `).bind(
      input.runId,
      input.triggerKind,
      input.startedAt,
      JSON.stringify(input.candidateDates),
      input.nextAlarmAt ?? null,
    ).run();
  }

  async finishRun(input: RunFinish): Promise<void> {
    await this.db.prepare(`
      UPDATE collector_runs
      SET finished_at = ?, status = ?, source_status = ?, raw_write_count = ?,
          published_dates_json = ?, error_code = ?, error_message = ?, next_alarm_at = ?
      WHERE run_id = ?
    `).bind(
      input.finishedAt,
      input.status,
      input.sourceStatus ?? null,
      input.rawWriteCount,
      JSON.stringify(input.publishedDates),
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.nextAlarmAt ?? null,
      input.runId,
    ).run();
  }

  async updateRunCandidates(runId: string, candidateDates: string[]): Promise<void> {
    await this.db.prepare(`
      UPDATE collector_runs
      SET candidate_dates_json = ?
      WHERE run_id = ?
    `).bind(JSON.stringify(candidateDates), runId).run();
  }

  async recordCollectionSuccess(input: {
    at: string;
    lastPublishedDate: string | null;
    nextAlarmAt?: string | null;
    recordAlarmAt: boolean;
  }): Promise<void> {
    await this.db.prepare(`
      UPDATE collector_state
      SET last_alarm_at = CASE WHEN ? THEN ? ELSE last_alarm_at END,
          last_source_success_at = ?,
          last_published_date = CASE
            WHEN ? IS NULL THEN last_published_date
            WHEN last_published_date IS NULL OR ? > last_published_date THEN ?
            ELSE last_published_date
          END,
          consecutive_failures = 0,
          next_alarm_at = COALESCE(?, next_alarm_at),
          updated_at = ?
      WHERE state_key = 'singleton'
    `).bind(
      input.recordAlarmAt ? 1 : 0,
      input.at,
      input.at,
      input.lastPublishedDate,
      input.lastPublishedDate,
      input.lastPublishedDate,
      input.nextAlarmAt ?? null,
      input.at,
    ).run();
  }

  async recordCollectionFailure(input: {
    at: string;
    nextAlarmAt?: string | null;
    recordAlarmAt: boolean;
  }): Promise<void> {
    await this.db.prepare(`
      UPDATE collector_state
      SET last_alarm_at = CASE WHEN ? THEN ? ELSE last_alarm_at END,
          consecutive_failures = consecutive_failures + 1,
          next_alarm_at = COALESCE(?, next_alarm_at), updated_at = ?
      WHERE state_key = 'singleton'
    `).bind(input.recordAlarmAt ? 1 : 0, input.at, input.nextAlarmAt ?? null, input.at).run();
  }

  async setNextAlarm(nextAlarmAt: string, updatedAt: string): Promise<void> {
    await this.db.prepare(`
      UPDATE collector_state
      SET next_alarm_at = ?, updated_at = ?
      WHERE state_key = 'singleton'
    `).bind(nextAlarmAt, updatedAt).run();
  }

  async upsertIceObservations(rows: IceObservation[]): Promise<{ inserted: number; current: number }> {
    if (rows.length === 0) return { inserted: 0, current: 0 };
    const statements = rows.flatMap((row) => [
      this.db.prepare(`
        INSERT INTO ice_eod_revisions (
          clearing_date, company, ice_name, instrument_name, eod_price, coupon_bp,
          payload_hash, retrieved_at, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clearing_date, company, instrument_name, payload_hash) DO NOTHING
      `).bind(
        row.clearingDate,
        row.company,
        row.iceName,
        row.instrumentName,
        row.eodPrice,
        row.couponBp,
        row.payloadHash,
        row.retrievedAt,
        row.sourceUrl,
      ),
      this.db.prepare(`
        INSERT INTO ice_eod_current (clearing_date, company, revision_id)
        SELECT ?, ?, revision_id
        FROM ice_eod_revisions
        WHERE clearing_date = ? AND company = ? AND instrument_name = ? AND payload_hash = ?
        ON CONFLICT(clearing_date, company) DO UPDATE SET revision_id = excluded.revision_id
        WHERE
          (SELECT retrieved_at FROM ice_eod_revisions WHERE revision_id = excluded.revision_id)
            > (SELECT retrieved_at FROM ice_eod_revisions WHERE revision_id = ice_eod_current.revision_id)
          OR (
            (SELECT retrieved_at FROM ice_eod_revisions WHERE revision_id = excluded.revision_id)
              = (SELECT retrieved_at FROM ice_eod_revisions WHERE revision_id = ice_eod_current.revision_id)
            AND excluded.revision_id > ice_eod_current.revision_id
          )
      `).bind(
        row.clearingDate,
        row.company,
        row.clearingDate,
        row.company,
        row.instrumentName,
        row.payloadHash,
      ),
    ]);
    const result = await this.db.batch(statements);
    return rows.reduce((counts, _row, index) => ({
      inserted: counts.inserted + result[index * 2].meta.changes,
      current: counts.current + result[index * 2 + 1].meta.changes,
    }), { inserted: 0, current: 0 });
  }

  async upsertTreasuryCurve(curve: TreasuryCurve): Promise<void> {
    await this.db.prepare(`
      INSERT INTO treasury_curves (
        curve_id, as_of, currency, source_label, source_url, retrieved_at, payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(curve_id) DO UPDATE SET
        as_of = excluded.as_of,
        currency = excluded.currency,
        source_label = excluded.source_label,
        source_url = excluded.source_url,
        retrieved_at = excluded.retrieved_at,
        payload_hash = excluded.payload_hash
    `).bind(
      curve.curveId,
      curve.asOf,
      curve.currency,
      curve.sourceLabel,
      curve.sourceUrl,
      curve.retrievedAt,
      curve.payloadHash,
    ).run();
    if (curve.nodes.length > 0) {
      await this.db.batch(curve.nodes.map((node) => this.db.prepare(
        `INSERT INTO treasury_curve_nodes (curve_id, years, zero_rate) VALUES (?, ?, ?)
         ON CONFLICT(curve_id, years) DO UPDATE SET zero_rate = excluded.zero_rate`,
      ).bind(curve.curveId, node.years, node.zeroRate)));
    }
  }

  async getCurrentObservations(clearingDate: string): Promise<StoredIceObservation[]> {
    const result = await this.db.prepare(`
      SELECT revisions.revision_id, revisions.clearing_date, revisions.company,
             revisions.ice_name, revisions.instrument_name, revisions.eod_price,
             revisions.coupon_bp, revisions.payload_hash, revisions.retrieved_at,
             revisions.source_url
      FROM ice_eod_current AS current
      JOIN ice_eod_revisions AS revisions USING (revision_id)
      WHERE current.clearing_date = ?
      ORDER BY revisions.company ASC
    `).bind(clearingDate).all<IceRevisionRow>();
    return result.results.map(toStoredIceObservation);
  }

  async listPartialDates(): Promise<Array<{ clearingDate: string; missingCompanies: Company[] }>> {
    const result = await this.db.prepare(`
      SELECT clearing_date, company
      FROM ice_eod_current
      ORDER BY clearing_date ASC, company ASC
    `).all<{ clearing_date: string; company: Company }>();
    const companiesByDate = new Map<string, Set<Company>>();
    for (const row of result.results) {
      const companies = companiesByDate.get(row.clearing_date) ?? new Set<Company>();
      companies.add(row.company);
      companiesByDate.set(row.clearing_date, companies);
    }
    return [...companiesByDate.entries()].flatMap(([clearingDate, companies]) => {
      const missingCompanies = TRACKED_COMPANIES.filter((company) => !companies.has(company));
      return missingCompanies.length === 0 ? [] : [{ clearingDate, missingCompanies }];
    });
  }

  async listObservedDates(): Promise<string[]> {
    const result = await this.db.prepare(`
      SELECT DISTINCT clearing_date
      FROM ice_eod_current
      ORDER BY clearing_date ASC
    `).all<{ clearing_date: string }>();
    return result.results.map((row) => row.clearing_date);
  }

  async currentPublishedSpreadRevisionIds(clearingDate: string): Promise<Map<Company, number> | null> {
    const current = await this.db.prepare(`
      SELECT rows.company, rows.spread_revision_id
      FROM published_batch_current AS pointer
      JOIN published_batch_rows AS rows ON rows.batch_id = pointer.batch_id
      WHERE pointer.clearing_date = ?
      ORDER BY rows.company ASC
    `).bind(clearingDate).all<{ company: Company; spread_revision_id: number }>();
    if (current.results.length === 0) return null;
    return new Map(current.results.map((row) => [row.company, row.spread_revision_id]));
  }

  async currentPublishedBatchId(clearingDate: string): Promise<string | null> {
    const current = await this.db.prepare(`
      SELECT batch_id
      FROM published_batch_current
      WHERE clearing_date = ?
    `).bind(clearingDate).first<{ batch_id: string }>();
    return current?.batch_id ?? null;
  }

  async nextBatchRevision(clearingDate: string): Promise<number> {
    const row = await this.db.prepare(`
      SELECT COALESCE(MAX(revision), 0) AS revision
      FROM published_batches
      WHERE clearing_date = ?
    `).bind(clearingDate).first<{ revision: number }>();
    return (row?.revision ?? 0) + 1;
  }

  async saveSpreadRevisions(rows: DerivedSpread[]): Promise<StoredDerivedSpread[]> {
    const stored: StoredDerivedSpread[] = [];
    for (const row of rows) {
      await this.db.prepare(`
        INSERT INTO cds_spread_revisions (
          clearing_date, company, ice_revision_id, curve_id, instrument_name, maturity_date,
          eod_price, coupon_bp, spread_bp, round_trip_price, price_residual, hazard_rate,
          recovery_rate, model_version, quality_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clearing_date, company, ice_revision_id, curve_id, model_version) DO NOTHING
      `).bind(
        row.clearingDate,
        row.company,
        row.iceRevisionId,
        row.curveId,
        row.instrumentName,
        row.maturityDate,
        row.eodPrice,
        row.couponBp,
        row.spreadBp,
        row.roundTripPrice,
        row.priceResidual,
        row.hazardRate,
        row.recoveryRate,
        row.modelVersion,
        row.qualityStatus,
        row.createdAt,
      ).run();
      const saved = await this.db.prepare(`
        SELECT spread_revision_id, clearing_date, company, ice_revision_id, curve_id,
               instrument_name, maturity_date, eod_price, coupon_bp, spread_bp,
               round_trip_price, price_residual, hazard_rate, recovery_rate, model_version,
               quality_status, created_at
        FROM cds_spread_revisions
        WHERE clearing_date = ? AND company = ? AND ice_revision_id = ? AND curve_id = ?
              AND model_version = ?
      `).bind(row.clearingDate, row.company, row.iceRevisionId, row.curveId, row.modelVersion)
        .first<SpreadRevisionRow>();
      if (!saved) throw new Error('Spread revision was not available after insertion');
      stored.push(toStoredDerivedSpread(saved));
    }
    return stored;
  }

  async publishBatch(input: PublishBatchInput): Promise<PublishedBatch> {
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO published_batches (
          batch_id, clearing_date, revision, published_at, source_kind, quality_status
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(clearing_date, revision) DO NOTHING
      `).bind(
        input.batchId,
        input.clearingDate,
        input.revision,
        input.publishedAt,
        input.sourceKind,
        input.qualityStatus,
      ),
      ...input.rows.map((row) => this.db.prepare(`
        INSERT INTO published_batch_rows (batch_id, company, spread_revision_id)
        SELECT batch_id, ?, ?
        FROM published_batches
        WHERE clearing_date = ? AND revision = ?
        ON CONFLICT(batch_id, company) DO NOTHING
      `).bind(
        row.company,
        row.spreadRevisionId,
        input.clearingDate,
        input.revision,
      )),
      this.db.prepare(`
        INSERT INTO published_batch_current (clearing_date, batch_id)
        SELECT ?, batch_id
        FROM published_batches
        WHERE clearing_date = ? AND revision = ?
        ON CONFLICT(clearing_date) DO UPDATE SET batch_id = excluded.batch_id
        WHERE
          (SELECT revision FROM published_batches WHERE batch_id = excluded.batch_id)
            >= (SELECT revision FROM published_batches WHERE batch_id = published_batch_current.batch_id)
      `).bind(input.clearingDate, input.clearingDate, input.revision),
    ]);
    const stored = await this.db.prepare(`
      SELECT batch_id, clearing_date, revision, published_at, source_kind, quality_status
      FROM published_batches
      WHERE clearing_date = ? AND revision = ?
    `).bind(input.clearingDate, input.revision).first<BatchRow>();
    if (!stored) throw new Error('Published batch was not available after insertion');
    return toPublishedBatch(stored);
  }

  async compareAndPublishBatch(input: CompareAndPublishBatchInput): Promise<CompareAndPublishBatchResult> {
    const matchesExpectedCurrent = `(
      (? IS NULL AND NOT EXISTS (
        SELECT 1 FROM published_batch_current WHERE clearing_date = ?
      )) OR (? IS NOT NULL AND EXISTS (
        SELECT 1 FROM published_batch_current WHERE clearing_date = ? AND batch_id = ?
      ))
    )`;
    const expectedBindings = [
      input.expectedCurrentBatchId,
      input.clearingDate,
      input.expectedCurrentBatchId,
      input.clearingDate,
      input.expectedCurrentBatchId,
    ];
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO published_batches (
          batch_id, clearing_date, revision, published_at, source_kind, quality_status
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE ${matchesExpectedCurrent}
        ON CONFLICT(clearing_date, revision) DO NOTHING
      `).bind(
        input.batchId,
        input.clearingDate,
        input.revision,
        input.publishedAt,
        input.sourceKind,
        input.qualityStatus,
        ...expectedBindings,
      ),
      ...input.rows.map((row) => this.db.prepare(`
        INSERT INTO published_batch_rows (batch_id, company, spread_revision_id)
        SELECT batch_id, ?, ?
        FROM published_batches
        WHERE clearing_date = ? AND revision = ? AND ${matchesExpectedCurrent}
        ON CONFLICT(batch_id, company) DO NOTHING
      `).bind(
        row.company,
        row.spreadRevisionId,
        input.clearingDate,
        input.revision,
        ...expectedBindings,
      )),
      this.db.prepare(`
        INSERT INTO published_batch_current (clearing_date, batch_id)
        SELECT ?, ?
        WHERE EXISTS (SELECT 1 FROM published_batches WHERE batch_id = ?)
          AND ${matchesExpectedCurrent}
        ON CONFLICT(clearing_date) DO UPDATE SET batch_id = excluded.batch_id
        WHERE published_batch_current.batch_id = ?
      `).bind(
        input.clearingDate,
        input.batchId,
        input.batchId,
        ...expectedBindings,
        input.expectedCurrentBatchId,
      ),
    ]);
    const currentBatchId = await this.currentPublishedBatchId(input.clearingDate);
    if (currentBatchId !== input.batchId) return { status: 'competition' };
    const stored = await this.db.prepare(`
      SELECT batch_id, clearing_date, revision, published_at, source_kind, quality_status
      FROM published_batches
      WHERE batch_id = ?
    `).bind(input.batchId).first<BatchRow>();
    if (!stored) return { status: 'competition' };
    return { status: 'published', batch: toPublishedBatch(stored) };
  }

  async latestBatch(): Promise<PublishedBatch | null> {
    const batch = await this.db.prepare(`
      SELECT batches.batch_id, batches.clearing_date, batches.revision,
             batches.published_at, batches.source_kind, batches.quality_status
      FROM published_batch_current AS current
      JOIN published_batches AS batches USING (batch_id)
      ORDER BY batches.clearing_date DESC, batches.revision DESC
      LIMIT 1
    `).first<BatchRow>();
    return batch ? toPublishedBatch(batch) : null;
  }

  async history(query: HistoryQuery): Promise<HistoryPage> {
    const cursor = decodeHistoryCursor(query.cursor);
    const result = await this.db.prepare(`
      SELECT batch_id, clearing_date, revision, published_at, source_kind, quality_status
      FROM published_batches
      WHERE clearing_date >= ? AND clearing_date <= ?
        AND (
          ? IS NULL
          OR clearing_date > ?
          OR (clearing_date = ? AND revision > ?)
        )
      ORDER BY clearing_date ASC, revision ASC
      LIMIT ?
    `).bind(
      query.from,
      query.to,
      cursor?.clearingDate ?? null,
      cursor?.clearingDate ?? null,
      cursor?.clearingDate ?? null,
      cursor?.revision ?? null,
      query.limit + 1,
    )
      .all<BatchRow>();
    const rows = result.results.map(toPublishedBatch);
    const data = rows.slice(0, query.limit);
    return {
      data,
      nextCursor: rows.length > query.limit && data.length > 0 ? encodeHistoryCursor(data.at(-1)!) : null,
    };
  }

  async exportSource(query: ExportQuery): Promise<ExportPage> {
    const cursor = query.cursor === null || query.cursor === undefined ? null : Number(query.cursor);
    const result = await this.db.prepare(`
      SELECT revision_id, clearing_date, company, ice_name, instrument_name, eod_price,
             coupon_bp, payload_hash, retrieved_at, source_url
      FROM ice_eod_revisions
      WHERE (? IS NULL OR revision_id > ?)
      ORDER BY revision_id ASC
      LIMIT ?
    `).bind(cursor, cursor, query.limit + 1).all<IceRevisionRow>();
    const rows = result.results.map(toStoredIceObservation);
    const data = rows.slice(0, query.limit);
    return {
      data,
      nextCursor: rows.length > query.limit ? String(data.at(-1)?.revisionId) : null,
    };
  }

  async health(now: Date): Promise<CollectorHealth> {
    const state = await this.db.prepare(`
      SELECT last_alarm_at, last_source_success_at, last_published_date,
             consecutive_failures, next_alarm_at
      FROM collector_state
      WHERE state_key = ?
    `).bind('singleton').first<{
      last_alarm_at: string | null;
      last_source_success_at: string | null;
      last_published_date: string | null;
      consecutive_failures: number;
      next_alarm_at: string | null;
    }>();
    if (!state) throw new Error('Collector state is missing');
    return {
      lastAlarmAt: state.last_alarm_at,
      lastSourceSuccessAt: state.last_source_success_at,
      lastPublishedDate: state.last_published_date,
      consecutiveFailures: state.consecutive_failures,
      nextAlarmAt: state.next_alarm_at,
      stale: isCollectorStale(state.last_published_date, now),
    };
  }

  async countIceRevisions(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS count FROM ice_eod_revisions')
      .first<{ count: number }>();
    return row?.count ?? 0;
  }
}
