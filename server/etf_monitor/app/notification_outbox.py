"""Durable mail jobs. Deduplication is committed only after SMTP acceptance."""
from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import json
import sqlite3
import time
from uuid import uuid4


class NotificationOutbox:
    def __init__(self, db_path, *, lease_seconds=330, now=None):
        self.db_path = db_path
        self.lease_seconds = lease_seconds
        self.now = now or time.time
        with self._connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS notification_outbox (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt REAL NOT NULL DEFAULT 0, lease_until REAL NOT NULL DEFAULT 0,
                    lease_token TEXT, last_error TEXT, created_at REAL NOT NULL, sent_at REAL
                );
                CREATE TABLE IF NOT EXISTS notification_outbox_events (
                    symbol TEXT NOT NULL, candle_time TEXT NOT NULL, event_type TEXT NOT NULL,
                    job_id TEXT NOT NULL,
                    PRIMARY KEY(symbol, candle_time, event_type)
                );
            ''')

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def has_event(self, symbol, candle_time, event_type):
        event = (symbol, candle_time.isoformat(), event_type)
        with self._connect() as db:
            return self._has_event(db, event)

    @staticmethod
    def _has_event(db, event):
        return db.execute('''
            SELECT 1 FROM notification_events WHERE symbol=? AND candle_time=? AND event_type=?
            UNION ALL
            SELECT 1 FROM notification_outbox_events WHERE symbol=? AND candle_time=? AND event_type=?
            LIMIT 1
        ''', (*event, *event)).fetchone() is not None

    def enqueue(self, events, payload):
        events = sorted(set((symbol, candle_time.isoformat(), kind) for symbol, candle_time, kind in events))
        if not events:
            return False
        job_id = sha256(json.dumps(events).encode()).hexdigest()
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            # Reservation and payload persist in one transaction. A concurrent
            # refresh cannot send the same batch while the scheduler sends it.
            if any(self._has_event(db, event) for event in events):
                return False
            db.execute('INSERT INTO notification_outbox(id,payload,created_at) VALUES(?,?,?)',
                       (job_id, json.dumps(payload, ensure_ascii=False), self.now()))
            db.executemany('INSERT INTO notification_outbox_events VALUES(?,?,?,?)',
                           [(*event, job_id) for event in events])
        return True

    def claim(self):
        now = self.now()
        token = uuid4().hex
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('''
                SELECT * FROM notification_outbox
                WHERE state != 'sent' AND next_attempt <= ? AND lease_until <= ?
                ORDER BY created_at, id LIMIT 1
            ''', (now, now)).fetchone()
            if row is None:
                return None
            db.execute('''
                UPDATE notification_outbox SET state='sending', attempts=attempts+1,
                    lease_token=?, lease_until=? WHERE id=?
            ''', (token, now + self.lease_seconds, row['id']))
        return {**dict(row), 'payload': json.loads(row['payload']),
                'attempts': row['attempts'] + 1, 'lease_token': token}

    def accept(self, job):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            updated = db.execute('''
                UPDATE notification_outbox SET state='sent', sent_at=?, last_error=NULL,
                    lease_until=0, lease_token=NULL WHERE id=? AND lease_token=?
            ''', (self.now(), job['id'], job['lease_token']))
            if updated.rowcount:
                db.execute('''
                    INSERT OR IGNORE INTO notification_events(symbol,candle_time,event_type)
                    SELECT symbol,candle_time,event_type FROM notification_outbox_events WHERE job_id=?
                ''', (job['id'],))

    def fail(self, job, error):
        delay = min(600, 30 * 2 ** min(job['attempts'] - 1, 5))
        with self._connect() as db:
            db.execute('''
                UPDATE notification_outbox SET state='pending', next_attempt=?, last_error=?,
                    lease_until=0, lease_token=NULL, payload=? WHERE id=? AND lease_token=?
            ''', (self.now() + delay, str(error)[:1000],
                  json.dumps(job['payload'], ensure_ascii=False), job['id'], job['lease_token']))

    def health(self):
        with self._connect() as db:
            counts = db.execute('''
                SELECT COUNT(*) AS pending,
                    COALESCE(SUM(last_error IS NOT NULL),0) AS failed
                FROM notification_outbox WHERE state != 'sent'
            ''').fetchone()
            error = db.execute('''
                SELECT last_error FROM notification_outbox
                WHERE state != 'sent' AND last_error IS NOT NULL ORDER BY created_at LIMIT 1
            ''').fetchone()
            sent = db.execute('SELECT MAX(sent_at) FROM notification_outbox').fetchone()[0]
        return {**dict(counts), 'last_sent_at': sent, 'error': error[0] if error else None}
