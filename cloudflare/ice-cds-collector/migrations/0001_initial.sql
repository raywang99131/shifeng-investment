CREATE TABLE collector_runs (
  run_id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('alarm','cron','manual','seed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  source_status TEXT,
  candidate_dates_json TEXT NOT NULL DEFAULT '[]',
  raw_write_count INTEGER NOT NULL DEFAULT 0,
  published_dates_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  next_alarm_at TEXT
);

CREATE TABLE ice_eod_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  clearing_date TEXT NOT NULL,
  company TEXT NOT NULL,
  ice_name TEXT NOT NULL,
  instrument_name TEXT NOT NULL,
  eod_price REAL NOT NULL CHECK (eod_price >= 0),
  coupon_bp REAL NOT NULL CHECK (coupon_bp > 0),
  payload_hash TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  UNIQUE (clearing_date, company, instrument_name, payload_hash)
);

CREATE TABLE ice_eod_current (
  clearing_date TEXT NOT NULL,
  company TEXT NOT NULL,
  revision_id INTEGER NOT NULL REFERENCES ice_eod_revisions(revision_id),
  PRIMARY KEY (clearing_date, company)
);

CREATE TABLE treasury_curves (
  curve_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  currency TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE TABLE treasury_curve_nodes (
  curve_id TEXT NOT NULL REFERENCES treasury_curves(curve_id),
  years REAL NOT NULL,
  zero_rate REAL NOT NULL,
  PRIMARY KEY (curve_id, years)
);

CREATE TABLE cds_spread_revisions (
  spread_revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  clearing_date TEXT NOT NULL,
  company TEXT NOT NULL,
  ice_revision_id INTEGER NOT NULL REFERENCES ice_eod_revisions(revision_id),
  curve_id TEXT NOT NULL REFERENCES treasury_curves(curve_id),
  instrument_name TEXT NOT NULL,
  maturity_date TEXT NOT NULL,
  eod_price REAL NOT NULL,
  coupon_bp REAL NOT NULL,
  spread_bp REAL NOT NULL CHECK (spread_bp > 0),
  round_trip_price REAL NOT NULL,
  price_residual REAL NOT NULL,
  hazard_rate REAL NOT NULL,
  recovery_rate REAL NOT NULL,
  model_version TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (clearing_date, company, ice_revision_id, curve_id, model_version)
);

CREATE TABLE published_batches (
  batch_id TEXT PRIMARY KEY,
  clearing_date TEXT NOT NULL,
  revision INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  UNIQUE (clearing_date, revision)
);

CREATE TABLE published_batch_rows (
  batch_id TEXT NOT NULL REFERENCES published_batches(batch_id),
  company TEXT NOT NULL,
  spread_revision_id INTEGER NOT NULL REFERENCES cds_spread_revisions(spread_revision_id),
  PRIMARY KEY (batch_id, company)
);

CREATE TABLE published_batch_current (
  clearing_date TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES published_batches(batch_id)
);

CREATE TABLE seed_history (
  observation_date TEXT NOT NULL,
  company TEXT NOT NULL,
  value_bp REAL NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind = 'screenshot_backfill'),
  source_label TEXT NOT NULL,
  note TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (observation_date, company, source_kind)
);

CREATE TABLE collector_state (
  state_key TEXT PRIMARY KEY CHECK (state_key = 'singleton'),
  last_alarm_at TEXT,
  last_source_success_at TEXT,
  last_published_date TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_alarm_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO collector_state (state_key, updated_at) VALUES ('singleton', '1970-01-01T00:00:00.000Z');
CREATE INDEX ice_eod_current_date_company ON ice_eod_current(clearing_date, company);
CREATE INDEX ice_eod_revisions_date_company ON ice_eod_revisions(clearing_date, company, retrieved_at);
CREATE INDEX spread_revisions_date_company ON cds_spread_revisions(clearing_date, company, created_at);
CREATE INDEX published_batches_date_revision ON published_batches(clearing_date, revision DESC);
