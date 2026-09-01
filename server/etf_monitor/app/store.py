from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, time
from pathlib import Path

from app.models import AlertCreate, AlertLog, Candle

SAME_SLOT_COMPARISON_TIMES = {
    time(9, 45),
    time(13, 15),
}


class AlertStore:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    name TEXT NOT NULL,
                    alert_type TEXT NOT NULL DEFAULT 'volume_spike',
                    candle_time TEXT NOT NULL,
                    volume INTEGER NOT NULL,
                    prev_volume INTEGER NOT NULL,
                    ratio REAL NOT NULL,
                    threshold REAL NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(symbol, candle_time)
                )
                """
            )
            _ensure_column(
                connection,
                table_name="alerts",
                column_name="alert_type",
                ddl="ALTER TABLE alerts ADD COLUMN alert_type TEXT NOT NULL DEFAULT 'volume_spike'",
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS candles (
                    symbol TEXT NOT NULL,
                    name TEXT NOT NULL,
                    candle_time TEXT NOT NULL,
                    kline_period TEXT NOT NULL DEFAULT '15',
                    open REAL NOT NULL,
                    high REAL NOT NULL,
                    low REAL NOT NULL,
                    close REAL NOT NULL,
                    volume INTEGER NOT NULL,
                    amount REAL NOT NULL,
                    cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(symbol, candle_time, kline_period)
                )
                """
            )
            _ensure_candles_period_key(connection)
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS notification_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    candle_time TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(symbol, candle_time, event_type)
                )
                """
            )

    def save_alert(self, alert: AlertCreate) -> AlertLog:
        saved_alert, _ = self.save_alert_with_status(alert)
        return saved_alert

    def save_alert_with_status(self, alert: AlertCreate) -> tuple[AlertLog, bool]:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO alerts (
                    symbol, name, alert_type, candle_time, volume, prev_volume, ratio,
                    threshold, severity, message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    alert.symbol,
                    alert.name,
                    alert.alert_type,
                    alert.candle_time.isoformat(),
                    alert.volume,
                    alert.prev_volume,
                    alert.ratio,
                    alert.threshold,
                    alert.severity,
                    alert.message,
                ),
            )
            inserted = cursor.rowcount > 0
            row = connection.execute(
                """
                SELECT * FROM alerts
                WHERE symbol = ? AND candle_time = ?
                """,
                (alert.symbol, alert.candle_time.isoformat()),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist alert")
        return _alert_from_row(row), inserted

    def list_alerts(self, symbol: str, limit: int = 100) -> list[AlertLog]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM alerts
                WHERE symbol = ?
                AND alert_type = 'volume_spike'
                ORDER BY candle_time DESC
                LIMIT ?
                """,
                (symbol, limit),
            ).fetchall()
        return [_alert_from_row(row) for row in rows]

    def list_alerts_for_date(self, target_date) -> list[AlertLog]:
        start = datetime.combine(target_date, datetime.min.time()).isoformat()
        end = datetime.combine(target_date, datetime.max.time()).isoformat()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM alerts
                WHERE candle_time >= ?
                AND candle_time <= ?
                AND alert_type = 'volume_spike'
                ORDER BY candle_time ASC, symbol ASC
                """,
                (start, end),
            ).fetchall()
        return [_alert_from_row(row) for row in rows]

    def list_alerts_for_candle_time(self, candle_time: datetime) -> list[AlertLog]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM alerts
                WHERE candle_time = ?
                AND alert_type = 'volume_spike'
                ORDER BY symbol ASC
                """,
                (candle_time.isoformat(),),
            ).fetchall()
        return [_alert_from_row(row) for row in rows]

    def latest_alert(self, symbol: str) -> AlertLog | None:
        alerts = self.list_alerts(symbol, limit=1)
        return alerts[0] if alerts else None

    def save_notification_event_with_status(
        self,
        symbol: str,
        candle_time: datetime,
        event_type: str,
    ) -> tuple[datetime, bool]:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO notification_events (
                    symbol, candle_time, event_type
                ) VALUES (?, ?, ?)
                """,
                (symbol, candle_time.isoformat(), event_type),
            )
            inserted = cursor.rowcount > 0
            row = connection.execute(
                """
                SELECT created_at FROM notification_events
                WHERE symbol = ? AND candle_time = ? AND event_type = ?
                """,
                (symbol, candle_time.isoformat(), event_type),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist notification event")
        return _parse_db_timestamp(row["created_at"]), inserted

    def notification_event_exists(
        self,
        candle_time: datetime,
        event_type: str,
        symbol: str | None = None,
    ) -> bool:
        with self._connect() as connection:
            if symbol is None:
                row = connection.execute(
                    """
                    SELECT 1 FROM notification_events
                    WHERE candle_time = ? AND event_type = ?
                    LIMIT 1
                    """,
                    (candle_time.isoformat(), event_type),
                ).fetchone()
            else:
                row = connection.execute(
                    """
                    SELECT 1 FROM notification_events
                    WHERE symbol = ? AND candle_time = ? AND event_type = ?
                    LIMIT 1
                    """,
                    (symbol, candle_time.isoformat(), event_type),
                ).fetchone()
        return row is not None

    def notification_event_created_at(
        self,
        symbol: str,
        candle_time: datetime,
        event_type: str,
    ) -> datetime | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT created_at FROM notification_events
                WHERE symbol = ? AND candle_time = ? AND event_type = ?
                """,
                (symbol, candle_time.isoformat(), event_type),
            ).fetchone()
        if row is None:
            return None
        return _parse_db_timestamp(row["created_at"])

    def earliest_alert_created_at_for_candle_time(
        self, candle_time: datetime
    ) -> datetime | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT MIN(created_at) AS created_at FROM alerts
                WHERE candle_time = ? AND alert_type = 'volume_spike'
                """,
                (candle_time.isoformat(),),
            ).fetchone()
        if row is None or row["created_at"] is None:
            return None
        return _parse_db_timestamp(row["created_at"])

    def save_candles(self, candles: list[Candle]) -> None:
        self.upsert_candles(candles)

    def upsert_candles(self, candles: list[Candle]) -> None:
        if not candles:
            return
        with self._connect() as connection:
            connection.executemany(
                """
                INSERT INTO candles (
                    symbol, name, candle_time, kline_period, open, high, low, close, volume, amount
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, candle_time, kline_period) DO UPDATE SET
                    name = excluded.name,
                    open = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.open
                        ELSE candles.open
                    END,
                    high = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.high
                        ELSE candles.high
                    END,
                    low = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.low
                        ELSE candles.low
                    END,
                    close = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.close
                        ELSE candles.close
                    END,
                    volume = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.volume
                        ELSE candles.volume
                    END,
                    amount = MAX(candles.amount, excluded.amount),
                    cached_at = CURRENT_TIMESTAMP
                """,
                [
                    (
                        candle.symbol,
                        candle.name,
                        candle.time.isoformat(),
                        candle.kline_period,
                        candle.open,
                        candle.high,
                        candle.low,
                        candle.close,
                        candle.volume,
                        candle.amount,
                    )
                    for candle in candles
                ],
            )
            _sync_alert_volumes(connection, candles)

    def list_candles(self, symbol: str, limit: int = 120) -> list[Candle]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM (
                    SELECT * FROM candles
                    WHERE symbol = ?
                    ORDER BY candle_time DESC, CAST(kline_period AS INTEGER) DESC
                    LIMIT ?
                )
                ORDER BY candle_time ASC, CAST(kline_period AS INTEGER) ASC
                """,
                (symbol, limit),
            ).fetchall()
        return [_candle_from_row(row) for row in rows]

    def latest_update(self, symbol: str) -> datetime | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT MAX(cached_at) AS cached_at FROM candles WHERE symbol = ?
                """,
                (symbol,),
            ).fetchone()
        if row is None or row["cached_at"] is None:
            return None
        return _parse_db_timestamp(row["cached_at"])


class CandleCache:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS candles (
                    symbol TEXT NOT NULL,
                    name TEXT NOT NULL,
                    candle_time TEXT NOT NULL,
                    kline_period TEXT NOT NULL DEFAULT '15',
                    open REAL NOT NULL,
                    high REAL NOT NULL,
                    low REAL NOT NULL,
                    close REAL NOT NULL,
                    volume INTEGER NOT NULL,
                    amount REAL NOT NULL,
                    cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(symbol, candle_time, kline_period)
                )
                """
            )
            _ensure_candles_period_key(connection)

    def upsert_candles(self, candles: list[Candle]) -> None:
        if not candles:
            return
        with self._connect() as connection:
            connection.executemany(
                """
                INSERT INTO candles (
                    symbol, name, candle_time, kline_period, open, high, low, close, volume, amount
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, candle_time, kline_period) DO UPDATE SET
                    name = excluded.name,
                    open = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.open
                        ELSE candles.open
                    END,
                    high = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.high
                        ELSE candles.high
                    END,
                    low = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.low
                        ELSE candles.low
                    END,
                    close = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.close
                        ELSE candles.close
                    END,
                    volume = CASE
                        WHEN excluded.amount >= candles.amount THEN excluded.volume
                        ELSE candles.volume
                    END,
                    amount = MAX(candles.amount, excluded.amount),
                    cached_at = CURRENT_TIMESTAMP
                """,
                [
                    (
                        candle.symbol,
                        candle.name,
                        candle.time.isoformat(),
                        candle.kline_period,
                        candle.open,
                        candle.high,
                        candle.low,
                        candle.close,
                        candle.volume,
                        candle.amount,
                    )
                    for candle in candles
                ],
            )

    def list_candles(self, symbol: str, limit: int = 120) -> list[Candle]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM (
                    SELECT * FROM candles
                    WHERE symbol = ?
                    ORDER BY candle_time DESC, CAST(kline_period AS INTEGER) DESC
                    LIMIT ?
                )
                ORDER BY candle_time ASC, CAST(kline_period AS INTEGER) ASC
                """,
                (symbol, limit),
            ).fetchall()
        return [_candle_from_row(row) for row in rows]

    def latest_update(self, symbol: str) -> datetime | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT MAX(cached_at) AS cached_at FROM candles WHERE symbol = ?
                """,
                (symbol,),
            ).fetchone()
        if row is None or row["cached_at"] is None:
            return None
        return _parse_db_timestamp(row["cached_at"])


def _sync_alert_volumes(connection: sqlite3.Connection, candles: list[Candle]) -> None:
    seen = {
        (candle.symbol, candle.time.isoformat(), candle.kline_period)
        for candle in candles
    }
    for symbol, candle_time, kline_period in seen:
        current = connection.execute(
            """
            SELECT amount FROM candles
            WHERE symbol = ? AND candle_time = ? AND kline_period = ?
            """,
            (symbol, candle_time, kline_period),
        ).fetchone()
        alert = connection.execute(
            """
            SELECT threshold FROM alerts
            WHERE symbol = ? AND candle_time = ? AND alert_type = 'volume_spike'
            """,
            (symbol, candle_time),
        ).fetchone()
        if current is None or alert is None:
            continue

        comparison = _previous_candle_for_alert_sync(
            connection,
            symbol,
            candle_time,
            kline_period,
            current["amount"],
            alert["threshold"],
        )
        if comparison is None:
            if _has_valid_alert_sync_reference(
                connection,
                symbol,
                candle_time,
                kline_period,
                parsed_candle_time=_parse_datetime(candle_time),
            ):
                _delete_volume_spike_alert(connection, symbol, candle_time)
            continue

        previous, comparison_label = comparison
        volume = current["amount"]
        prev_volume = previous["amount"]
        ratio = round(volume / prev_volume, 2)
        connection.execute(
            """
            UPDATE alerts
            SET volume = ?,
                prev_volume = ?,
                ratio = ?,
                message = symbol || ' 15分钟成交额放大 ' || printf('%.2f', ?)
                    || ' 倍，当前额 ' || ? || '，' || ? || ' ' || ?
            WHERE symbol = ? AND candle_time = ? AND alert_type = 'volume_spike'
            """,
            (
                volume,
                prev_volume,
                ratio,
                ratio,
                volume,
                comparison_label,
                prev_volume,
                symbol,
                candle_time,
            ),
        )


def _previous_candle_for_alert_sync(
    connection: sqlite3.Connection,
    symbol: str,
    candle_time: str,
    kline_period: str,
    current_volume: int,
    threshold: float,
) -> tuple[sqlite3.Row, str] | None:
    parsed_candle_time = _parse_datetime(candle_time)
    if _uses_previous_trading_day_same_slot(parsed_candle_time):
        previous = _previous_trading_day_same_slot_for_alert_sync(
            connection, symbol, candle_time, kline_period, parsed_candle_time
        )
        if _meets_alert_sync_threshold(current_volume, previous, threshold):
            return previous, f"前一交易日{parsed_candle_time:%H:%M}"
        return None

    same_day_previous = connection.execute(
        """
        SELECT amount FROM candles
        WHERE symbol = ? AND kline_period = ? AND candle_time < ?
        ORDER BY candle_time DESC
        LIMIT 1
        """,
        (symbol, kline_period, candle_time),
    ).fetchone()
    if _meets_alert_sync_threshold(current_volume, same_day_previous, threshold):
        return same_day_previous, "前一根"

    previous_day_same_slot = _previous_trading_day_same_slot_for_alert_sync(
        connection, symbol, candle_time, kline_period, parsed_candle_time
    )
    if _meets_alert_sync_threshold(current_volume, previous_day_same_slot, threshold):
        return previous_day_same_slot, f"前一交易日{parsed_candle_time:%H:%M}"
    return None


def _has_valid_alert_sync_reference(
    connection: sqlite3.Connection,
    symbol: str,
    candle_time: str,
    kline_period: str,
    parsed_candle_time: datetime,
) -> bool:
    if _uses_previous_trading_day_same_slot(parsed_candle_time):
        previous = _previous_trading_day_same_slot_for_alert_sync(
            connection, symbol, candle_time, kline_period, parsed_candle_time
        )
        return _has_positive_amount(previous)

    same_day_previous = connection.execute(
        """
        SELECT amount FROM candles
        WHERE symbol = ? AND kline_period = ? AND candle_time < ?
        ORDER BY candle_time DESC
        LIMIT 1
        """,
        (symbol, kline_period, candle_time),
    ).fetchone()
    if _has_positive_amount(same_day_previous):
        return True

    previous_day_same_slot = _previous_trading_day_same_slot_for_alert_sync(
        connection, symbol, candle_time, kline_period, parsed_candle_time
    )
    return _has_positive_amount(previous_day_same_slot)


def _has_positive_amount(row: sqlite3.Row | None) -> bool:
    return row is not None and row["amount"] > 0


def _delete_volume_spike_alert(
    connection: sqlite3.Connection,
    symbol: str,
    candle_time: str,
) -> None:
    connection.execute(
        """
        DELETE FROM alerts
        WHERE symbol = ? AND candle_time = ? AND alert_type = 'volume_spike'
        """,
        (symbol, candle_time),
    )


def _previous_trading_day_same_slot_for_alert_sync(
    connection: sqlite3.Connection,
    symbol: str,
    candle_time: str,
    kline_period: str,
    parsed_candle_time: datetime,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT amount FROM candles
        WHERE symbol = ?
        AND kline_period = ?
        AND candle_time < ?
        AND substr(candle_time, 12, 5) = ?
        ORDER BY candle_time DESC
        LIMIT 1
        """,
        (symbol, kline_period, candle_time, f"{parsed_candle_time:%H:%M}"),
    ).fetchone()


def _meets_alert_sync_threshold(
    current_volume: int,
    previous: sqlite3.Row | None,
    threshold: float,
) -> bool:
    if previous is None or previous["amount"] <= 0:
        return False
    return current_volume / previous["amount"] >= threshold


def _uses_previous_trading_day_same_slot(candle_time: datetime) -> bool:
    return candle_time.time() in SAME_SLOT_COMPARISON_TIMES


def _alert_from_row(row: sqlite3.Row) -> AlertLog:
    return AlertLog(
        id=row["id"],
        symbol=row["symbol"],
        name=row["name"],
        alert_type=row["alert_type"],
        candle_time=_parse_datetime(row["candle_time"]),
        volume=row["volume"],
        prev_volume=row["prev_volume"],
        ratio=row["ratio"],
        threshold=row["threshold"],
        severity=row["severity"],
        message=row["message"],
        created_at=_parse_db_timestamp(row["created_at"]),
    )


def _candle_from_row(row: sqlite3.Row) -> Candle:
    return Candle(
        symbol=row["symbol"],
        name=row["name"],
        time=_parse_datetime(row["candle_time"]),
        open=row["open"],
        high=row["high"],
        low=row["low"],
        close=row["close"],
        volume=row["volume"],
        amount=row["amount"],
        kline_period=row["kline_period"] if "kline_period" in row.keys() else "15",
    )


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _parse_db_timestamp(value: str) -> datetime:
    parsed = _parse_datetime(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _ensure_column(
    connection: sqlite3.Connection,
    table_name: str,
    column_name: str,
    ddl: str,
) -> None:
    columns = {
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if column_name not in columns:
        connection.execute(ddl)


def _ensure_candles_period_key(connection: sqlite3.Connection) -> None:
    columns = connection.execute("PRAGMA table_info(candles)").fetchall()
    column_names = {row["name"] for row in columns}
    pk_columns = [row["name"] for row in columns if row["pk"]]
    if "kline_period" in column_names and pk_columns == [
        "symbol",
        "candle_time",
        "kline_period",
    ]:
        return

    connection.execute("ALTER TABLE candles RENAME TO candles_old")
    connection.execute(
        """
        CREATE TABLE candles (
            symbol TEXT NOT NULL,
            name TEXT NOT NULL,
            candle_time TEXT NOT NULL,
            kline_period TEXT NOT NULL DEFAULT '15',
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume INTEGER NOT NULL,
            amount REAL NOT NULL,
            cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(symbol, candle_time, kline_period)
        )
        """
    )
    if "kline_period" in column_names:
        connection.execute(
            """
            INSERT OR REPLACE INTO candles (
                symbol, name, candle_time, kline_period, open, high, low, close,
                volume, amount, cached_at
            )
            SELECT symbol, name, candle_time, kline_period, open, high, low, close,
                volume, amount, cached_at
            FROM candles_old
            """
        )
    else:
        connection.execute(
            """
            INSERT OR REPLACE INTO candles (
                symbol, name, candle_time, kline_period, open, high, low, close,
                volume, amount, cached_at
            )
            SELECT symbol, name, candle_time,
                CASE WHEN time(candle_time) > '14:30:00' THEN '5' ELSE '15' END,
                open, high, low, close, volume, amount, cached_at
            FROM candles_old
            """
        )
    connection.execute("DROP TABLE candles_old")
