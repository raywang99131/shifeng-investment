export interface Env {
  DB: D1Database;
  CDS_COLLECTOR: DurableObjectNamespace;
  READ_TOKEN: string;
  WRITE_TOKEN: string;
  ENVIRONMENT: 'test' | 'staging' | 'production';
}

export type Company = string;
export type TriggerKind = 'alarm' | 'cron' | 'manual' | 'seed';
export type RunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface RunStart {
  runId: string;
  triggerKind: TriggerKind;
  startedAt: string;
  candidateDates: string[];
  nextAlarmAt?: string | null;
}

export interface RunFinish {
  runId: string;
  finishedAt: string;
  status: Exclude<RunStatus, 'running'>;
  sourceStatus?: string | null;
  rawWriteCount: number;
  publishedDates: string[];
  errorCode?: string | null;
  errorMessage?: string | null;
  nextAlarmAt?: string | null;
}

export interface IceObservation {
  clearingDate: string;
  company: Company;
  iceName: string;
  instrumentName: string;
  eodPrice: number;
  couponBp: number;
  payloadHash: string;
  retrievedAt: string;
  sourceUrl: string;
}

export interface StoredIceObservation extends IceObservation {
  revisionId: number;
}

export interface TreasuryCurveNode {
  years: number;
  zeroRate: number;
}

export interface TreasuryCurve {
  curveId: string;
  asOf: string;
  currency: string;
  sourceLabel: string;
  sourceUrl: string;
  retrievedAt: string;
  payloadHash: string;
  nodes: TreasuryCurveNode[];
}

export interface DerivedSpread {
  clearingDate: string;
  company: Company;
  iceRevisionId: number;
  curveId: string;
  instrumentName: string;
  maturityDate: string;
  eodPrice: number;
  couponBp: number;
  spreadBp: number;
  roundTripPrice: number;
  priceResidual: number;
  hazardRate: number;
  recoveryRate: number;
  modelVersion: string;
  qualityStatus: string;
  createdAt: string;
}

export interface StoredDerivedSpread extends DerivedSpread {
  spreadRevisionId: number;
}

export interface PublishBatchInput {
  batchId: string;
  clearingDate: string;
  revision: number;
  publishedAt: string;
  sourceKind: string;
  qualityStatus: string;
  rows: Array<{ company: Company; spreadRevisionId: number }>;
}

export interface PublishedBatch {
  batchId: string;
  clearingDate: string;
  revision: number;
  publishedAt: string;
  sourceKind: string;
  qualityStatus: string;
}

export interface HistoryQuery {
  from: string;
  to: string;
  cursor?: string | null;
  limit: number;
}

export interface HistoryPage {
  data: PublishedBatch[];
  nextCursor: string | null;
}

export interface ExportQuery {
  cursor?: string | null;
  limit: number;
}

export interface ExportPage {
  data: unknown[];
  nextCursor: string | null;
}

export interface CollectorHealth {
  lastAlarmAt: string | null;
  lastSourceSuccessAt: string | null;
  lastPublishedDate: string | null;
  consecutiveFailures: number;
  nextAlarmAt: string | null;
  stale: boolean;
}
