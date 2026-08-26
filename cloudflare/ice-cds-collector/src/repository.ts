import type {
  CollectorHealth,
  AuditExportEntry,
  AuditExportSection,
  Company,
  CompareAndPublishBatchInput,
  CompareAndPublishBatchResult,
  DerivedSpread,
  ExportPage,
  ExportQuery,
  HistoryPage,
  HistoryQuery,
  HistorySnapshotPage,
  HistoryBatchSnapshot,
  LatestBatchSnapshot,
  IceObservation,
  LatestBatchCompany,
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

type LatestCompanyRow = {
  batch_company: string;
  spread_company: string;
  spread_clearing_date: string;
  spread_bp: number;
  eod_price: number;
  instrument_name: string;
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

const AUDIT_SECTIONS: readonly AuditExportSection[] = [
  'ice_eod_revisions', 'ice_eod_current', 'treasury_curves', 'cds_spread_revisions',
  'published_batches', 'published_batch_current', 'seed_history',
];

type ExportWatermarks = Record<AuditExportSection, number>;
type ExportPointers = { iceCurrent: string; batchCurrent: string };
type AuditCursor = { v: 2; section: AuditExportSection; key: number | null; watermarks: ExportWatermarks; pointers: ExportPointers };

export class InvalidExportCursorError extends Error {}
export class ExportSnapshotChangedError extends Error {}

const cursorNumber = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const cursorKeys = (value: unknown): value is Record<AuditExportSection, unknown> => typeof value === 'object' && value !== null
  && Object.keys(value).length === AUDIT_SECTIONS.length && AUDIT_SECTIONS.every((section) => cursorNumber((value as Record<string, unknown>)[section]));
const cursorPointers = (value: unknown): value is ExportPointers => typeof value === 'object' && value !== null
  && typeof (value as Record<string, unknown>).iceCurrent === 'string' && /^[a-f0-9]{64}$/.test((value as Record<string, unknown>).iceCurrent as string)
  && typeof (value as Record<string, unknown>).batchCurrent === 'string' && /^[a-f0-9]{64}$/.test((value as Record<string, unknown>).batchCurrent as string);
const encodeAuditCursor = (cursor: AuditCursor): string => `v1.${btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
const decodeAuditCursor = (cursor: string): AuditCursor => {
  if (!/^v1\.[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidExportCursorError('Invalid export cursor');
  try {
    const encoded = cursor.slice(3).replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(encoded.padEnd(encoded.length + (4 - encoded.length % 4) % 4, '='))) as Partial<AuditCursor>;
    if (parsed.v !== 2 || !AUDIT_SECTIONS.includes(parsed.section as AuditExportSection)
      || (parsed.key !== null && !cursorNumber(parsed.key)) || !cursorKeys(parsed.watermarks) || !cursorPointers(parsed.pointers)) {
      throw new Error('invalid');
    }
    return parsed as AuditCursor;
  } catch { throw new InvalidExportCursorError('Invalid export cursor'); }
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
    const assertImmutable = async (): Promise<boolean> => {
      const existing = await this.db.prepare(`
        SELECT as_of, currency, source_label, source_url, payload_hash FROM treasury_curves WHERE curve_id = ?
      `).bind(curve.curveId).first<{ as_of: string; currency: string; source_label: string; source_url: string; payload_hash: string }>();
      if (!existing) return false;
      const nodes = await this.db.prepare(`SELECT years, zero_rate FROM treasury_curve_nodes WHERE curve_id = ? ORDER BY years ASC`)
        .bind(curve.curveId).all<{ years: number; zero_rate: number }>();
      const immutableMatch = existing.as_of === curve.asOf && existing.currency === curve.currency
        && existing.source_label === curve.sourceLabel && existing.source_url === curve.sourceUrl && existing.payload_hash === curve.payloadHash
        && JSON.stringify(nodes.results) === JSON.stringify([...curve.nodes].sort((left, right) => left.years - right.years).map((node) => ({ years: node.years, zero_rate: node.zeroRate })));
      if (!immutableMatch) throw new Error('Treasury curve identity conflicts with existing content');
      return true;
    };
    if (await assertImmutable()) return;
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO treasury_curves (
          curve_id, as_of, currency, source_label, source_url, retrieved_at, payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(curve_id) DO NOTHING
      `).bind(curve.curveId, curve.asOf, curve.currency, curve.sourceLabel, curve.sourceUrl, curve.retrievedAt, curve.payloadHash),
      ...curve.nodes.map((node) => this.db.prepare(`
        INSERT INTO treasury_curve_nodes (curve_id, years, zero_rate)
        SELECT ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM treasury_curves
          WHERE curve_id = ? AND as_of = ? AND currency = ? AND source_label = ?
            AND source_url = ? AND payload_hash = ?
        )
        ON CONFLICT(curve_id, years) DO NOTHING
      `).bind(curve.curveId, node.years, node.zeroRate, curve.curveId, curve.asOf, curve.currency,
        curve.sourceLabel, curve.sourceUrl, curve.payloadHash)),
    ]);
    if (!(await assertImmutable())) throw new Error('Treasury curve was not available after insertion');
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

  private async batchSnapshot<T extends PublishedBatch>(batch: T): Promise<T & { companies: LatestBatchCompany[] }> {
    const rows = await this.db.prepare(`
      SELECT rows.company AS batch_company, spreads.company AS spread_company, spreads.clearing_date AS spread_clearing_date, spreads.spread_bp, spreads.eod_price,
             spreads.instrument_name, spreads.quality_status
      FROM published_batch_rows AS rows
      JOIN cds_spread_revisions AS spreads USING (spread_revision_id)
      WHERE rows.batch_id = ?
      ORDER BY CASE rows.company
        WHEN 'Oracle' THEN 1 WHEN 'CoreWeave' THEN 2 WHEN 'NVIDIA' THEN 3
        WHEN 'Amazon' THEN 4 WHEN 'Google' THEN 5 WHEN 'Microsoft' THEN 6 WHEN 'Meta' THEN 7
        ELSE 999 END
    `).bind(batch.batchId).all<LatestCompanyRow>();
    if (rows.results.length !== TRACKED_COMPANIES.length || batch.sourceKind !== 'ice_eod_isda' || batch.qualityStatus !== 'model-derived'
      || new Set(rows.results.map((row) => row.batch_company)).size !== TRACKED_COMPANIES.length
      || !TRACKED_COMPANIES.every((company, index) => rows.results[index]?.batch_company === company
        && rows.results[index]?.spread_company === company && rows.results[index]?.spread_clearing_date === batch.clearingDate)) {
      throw new Error('Latest batch is incomplete');
    }
    const companies: LatestBatchCompany[] = rows.results.map((row) => {
      if (row.quality_status !== 'model-derived') throw new Error('Latest batch quality is invalid');
      return {
        company: row.batch_company as Company,
        spreadBp: row.spread_bp,
        eodPrice: row.eod_price,
        instrumentName: row.instrument_name,
        qualityStatus: 'model-derived',
      };
    });
    return { ...batch, companies };
  }

  async latestBatchSnapshot(): Promise<LatestBatchSnapshot | null> {
    const batch = await this.latestBatch();
    return batch ? this.batchSnapshot(batch) : null;
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

  async historySnapshots(query: HistoryQuery): Promise<HistorySnapshotPage> {
    const page = await this.history(query);
    return {
      data: await Promise.all(page.data.map((batch) => this.batchSnapshot(batch))) as HistoryBatchSnapshot[],
      nextCursor: page.nextCursor,
    };
  }

  async exportSource(query: ExportQuery): Promise<ExportPage> {
    const start = query.cursor ? decodeAuditCursor(query.cursor) : await this.startExportSnapshot();
    await this.assertExportSnapshot(start);
    let sectionIndex = AUDIT_SECTIONS.indexOf(start.section);
    let key = start.key;
    const data: AuditExportEntry[] = [];
    while (sectionIndex < AUDIT_SECTIONS.length && data.length < query.limit) {
      const section = AUDIT_SECTIONS[sectionIndex];
      const chunk = await this.auditSection(section, key, start.watermarks[section], query.limit - data.length);
      data.push(...chunk.data);
      await this.assertExportSnapshot(start);
      if (chunk.hasMore) return { data, nextCursor: encodeAuditCursor({ ...start, section, key: chunk.lastKey }) };
      sectionIndex += 1;
      key = null;
    }
    return {
      data,
      nextCursor: sectionIndex < AUDIT_SECTIONS.length ? encodeAuditCursor({ ...start, section: AUDIT_SECTIONS[sectionIndex], key: null }) : null,
    };
  }

  private async startExportSnapshot(): Promise<AuditCursor> {
    const max = async (table: string): Promise<number> => (await this.db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS value FROM ${table}`).first<{ value: number }>())?.value ?? 0;
    const watermarks = Object.fromEntries(await Promise.all(AUDIT_SECTIONS.map(async (section) => [section, await max({
      ice_eod_revisions: 'ice_eod_revisions', ice_eod_current: 'ice_eod_current', treasury_curves: 'treasury_curves',
      cds_spread_revisions: 'cds_spread_revisions', published_batches: 'published_batches', published_batch_current: 'published_batch_current', seed_history: 'seed_history',
    }[section])]))) as ExportWatermarks;
    const pointers = await this.currentPointerHashes();
    return { v: 2, section: AUDIT_SECTIONS[0], key: null, watermarks, pointers };
  }

  private async currentPointerHashes(): Promise<ExportPointers> {
    const digest = async (value: unknown): Promise<string> => {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    const [ice, batches] = await Promise.all([
      this.db.prepare(`SELECT clearing_date, company, revision_id FROM ice_eod_current ORDER BY clearing_date ASC, company ASC`).all(),
      this.db.prepare(`SELECT clearing_date, batch_id FROM published_batch_current ORDER BY clearing_date ASC`).all(),
    ]);
    return { iceCurrent: await digest(ice.results), batchCurrent: await digest(batches.results) };
  }

  private async assertExportSnapshot(cursor: AuditCursor): Promise<void> {
    const pointers = await this.currentPointerHashes();
    if (pointers.iceCurrent !== cursor.pointers.iceCurrent || pointers.batchCurrent !== cursor.pointers.batchCurrent) {
      throw new ExportSnapshotChangedError('Export snapshot changed');
    }
  }

  private async auditSection(section: AuditExportSection, cursor: number | null, watermark: number, limit: number): Promise<{
    data: AuditExportEntry[]; hasMore: boolean; lastKey: number;
  }> {
    const take = limit + 1;
    const after = cursor ?? 0;
    if (section === 'ice_eod_revisions') {
      const rows = await this.db.prepare(`SELECT rowid AS audit_row_id, revision_id, clearing_date, company, ice_name, instrument_name, eod_price, coupon_bp, payload_hash, retrieved_at, source_url FROM ice_eod_revisions WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC LIMIT ?`)
        .bind(after, watermark, take).all<IceRevisionRow & { audit_row_id: number }>();
      const visible = rows.results.slice(0, limit);
      return { data: visible.map((row) => ({ section, record: toStoredIceObservation(row) })), hasMore: rows.results.length > limit, lastKey: visible.at(-1)?.audit_row_id ?? after };
    }
    if (section === 'ice_eod_current') {
      const rows = await this.db.prepare(`SELECT rowid AS audit_row_id, clearing_date, company, revision_id FROM ice_eod_current WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC LIMIT ?`)
        .bind(after, watermark, take).all<{ audit_row_id: number; clearing_date: string; company: string; revision_id: number }>();
      const visible = rows.results.slice(0, limit);
      return { data: visible.map((row) => ({ section, record: { clearingDate: row.clearing_date, company: row.company, revisionId: row.revision_id } })), hasMore: rows.results.length > limit, lastKey: visible.at(-1)?.audit_row_id ?? after };
    }
    if (section === 'treasury_curves') {
      const rows = await this.db.prepare(`SELECT rowid AS audit_row_id, curve_id, as_of, currency, source_label, source_url, retrieved_at, payload_hash FROM treasury_curves WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC LIMIT ?`)
        .bind(after, watermark, take).all<{ audit_row_id: number; curve_id: string; as_of: string; currency: string; source_label: string; source_url: string; retrieved_at: string; payload_hash: string }>();
      const visible = rows.results.slice(0, limit);
      const data = await Promise.all(visible.map(async (row) => {
        const nodes = await this.db.prepare(`SELECT years, zero_rate FROM treasury_curve_nodes WHERE curve_id = ? ORDER BY years ASC`).bind(row.curve_id).all<{ years: number; zero_rate: number }>();
        return { section, record: { curveId: row.curve_id, asOf: row.as_of, currency: row.currency, sourceLabel: row.source_label, sourceUrl: row.source_url, retrievedAt: row.retrieved_at, payloadHash: row.payload_hash, nodes: nodes.results.map((node) => ({ years: node.years, zeroRate: node.zero_rate })) } };
      }));
      return { data, hasMore: rows.results.length > limit, lastKey: visible.at(-1)?.audit_row_id ?? after };
    }
    if (section === 'cds_spread_revisions') {
      const rows = await this.db.prepare(`SELECT rowid AS audit_row_id, spread_revision_id, clearing_date, company, ice_revision_id, curve_id, instrument_name, maturity_date, eod_price, coupon_bp, spread_bp, round_trip_price, price_residual, hazard_rate, recovery_rate, model_version, quality_status, created_at FROM cds_spread_revisions WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC LIMIT ?`)
        .bind(after, watermark, take).all<SpreadRevisionRow & { audit_row_id: number }>();
      const visible = rows.results.slice(0, limit);
      return { data: visible.map((row) => ({ section, record: toStoredDerivedSpread(row) })), hasMore: rows.results.length > limit, lastKey: visible.at(-1)?.audit_row_id ?? after };
    }
    if (section === 'published_batches') {
      const rows = await this.db.prepare(`SELECT rowid AS audit_row_id, batch_id, clearing_date, revision, published_at, source_kind, quality_status FROM published_batches WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC LIMIT ?`)
        .bind(after, watermark, take).all<BatchRow & { audit_row_id: number }>();
      const visible = rows.results.slice(0, limit);
      const data = await Promise.all(visible.map(async (row) => {
        const children = await this.db.prepare(`SELECT company, spread_revision_id FROM published_batch_rows WHERE batch_id = ? ORDER BY company ASC`).bind(row.batch_id).all<{ company: string; spread_revision_id: number }>();
        return { section, record: { ...toPublishedBatch(row), rows: children.results.map((child) => ({ company: child.company, spreadRevisionId: child.spread_revision_id })) } };
      }));
      return { data, hasMore: rows.results.length > limit, lastKey: visible.at(-1)?.audit_row_id ?? after };
    }
    if (section === 'published_batch_current') {
      const rows = await this.db.prepare(`SELECT rowid AS audit_row_id, clearing_date, batch_id FROM published_batch_current WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC LIMIT ?`)
        .bind(after, watermark, take).all<{ audit_row_id: number; clearing_date: string; batch_id: string }>();
      const visible = rows.results.slice(0, limit);
      return { data: visible.map((row) => ({ section, record: { clearingDate: row.clearing_date, batchId: row.batch_id } })), hasMore: rows.results.length > limit, lastKey: visible.at(-1)?.audit_row_id ?? after };
    }
    const rows = await this.db.prepare(`SELECT rowid AS audit_row_id, observation_date, company, value_bp, source_kind, source_label, note, imported_at FROM seed_history WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC LIMIT ?`)
      .bind(after, watermark, take).all<{ audit_row_id: number; observation_date: string; company: string; value_bp: number; source_kind: string; source_label: string; note: string; imported_at: string }>();
    const visible = rows.results.slice(0, limit);
    return { data: visible.map((row) => ({ section, record: { observationDate: row.observation_date, company: row.company, valueBp: row.value_bp, sourceKind: row.source_kind, sourceLabel: row.source_label, note: row.note, importedAt: row.imported_at } })), hasMore: rows.results.length > limit, lastKey: visible.at(-1)?.audit_row_id ?? after };
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
