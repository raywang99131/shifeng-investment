import sqlite3
from datetime import UTC, datetime

from app.models import AlertCreate, Candle
from app.store import AlertStore


def candle(time: str, volume: int, amount: float | None = None) -> Candle:
    return Candle(
        symbol="159915.SZ",
        name="创业板ETF易方达",
        time=datetime.fromisoformat(time),
        open=1.0,
        high=1.1,
        low=0.9,
        close=1.05,
        volume=volume,
        amount=amount if amount is not None else volume * 1.0,
    )


def alert(candle_time: datetime) -> AlertCreate:
    return AlertCreate(
        symbol="159915.SZ",
        name="创业板ETF易方达",
        candle_time=candle_time,
        volume=4200,
        prev_volume=1200,
        ratio=3.5,
        threshold=3.0,
        severity="warning",
        message="159915.SZ 15分钟成交量放大 3.50 倍",
    )


def test_store_deduplicates_alerts_by_symbol_and_candle_time(tmp_path):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-07-21T13:30:00")

    first = store.save_alert(alert(candle_time))
    second = store.save_alert(alert(candle_time))

    alerts = store.list_alerts("159915.SZ", limit=10)
    assert first.id == second.id
    assert len(alerts) == 1
    assert alerts[0].candle_time == candle_time


def test_store_reports_whether_alert_was_newly_inserted(tmp_path):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-07-21T13:30:00")

    first, first_inserted = store.save_alert_with_status(alert(candle_time))
    second, second_inserted = store.save_alert_with_status(alert(candle_time))

    assert first_inserted is True
    assert second_inserted is False
    assert first.id == second.id


def test_store_reads_sqlite_created_at_as_utc(tmp_path):
    db_path = tmp_path / "alerts.db"
    store = AlertStore(db_path)
    candle_time = datetime.fromisoformat("2026-07-21T13:30:00")
    store.save_alert(alert(candle_time))

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE alerts SET created_at = ? WHERE symbol = ?",
            ("2026-07-21 05:30:53", "159915.SZ"),
        )

    [saved_alert] = store.list_alerts("159915.SZ", limit=10)

    assert saved_alert.created_at == datetime(2026, 7, 21, 5, 30, 53, tzinfo=UTC)


def test_store_upserts_and_lists_cached_candles_by_symbol(tmp_path):
    store = AlertStore(tmp_path / "alerts.db")

    store.save_candles(
        [
            candle("2026-07-21T09:45:00", 1000),
            candle("2026-07-21T10:00:00", 1200),
        ]
    )
    store.save_candles(
        [
            candle("2026-07-21T10:00:00", 1500),
            candle("2026-07-21T10:15:00", 1600),
        ]
    )

    candles = store.list_candles("159915.SZ", limit=10)
    assert [item.time for item in candles] == [
        datetime.fromisoformat("2026-07-21T09:45:00"),
        datetime.fromisoformat("2026-07-21T10:00:00"),
        datetime.fromisoformat("2026-07-21T10:15:00"),
    ]
    assert [item.volume for item in candles] == [1000, 1500, 1600]


def test_store_keeps_larger_cached_amount_when_later_update_is_partial(tmp_path):
    store = AlertStore(tmp_path / "alerts.db")

    store.save_candles(
        [candle("2026-08-07T11:00:00", 114_719_600, amount=413_254_705)]
    )
    store.save_candles(
        [candle("2026-08-07T11:00:00", 1_245_100, amount=4_486_682.6542)]
    )

    [saved_candle] = store.list_candles("159915.SZ", limit=10)

    assert saved_candle.volume == 114_719_600
    assert saved_candle.amount == 413_254_705


def test_store_syncs_alert_volumes_when_cached_candles_change(tmp_path):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-07-21T10:00:00")
    store.save_alert(alert(candle_time))

    store.save_candles(
        [
            candle("2026-07-21T09:45:00", 120000),
            candle("2026-07-21T10:00:00", 420000),
        ]
    )

    [saved_alert] = store.list_alerts("159915.SZ", limit=10)

    assert saved_alert.volume == 420000
    assert saved_alert.prev_volume == 120000
    assert saved_alert.ratio == 3.5


def test_store_syncs_alert_metric_from_cached_amount_not_volume(tmp_path):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-07-21T10:00:00")
    store.save_alert(
        AlertCreate(
            symbol="159915.SZ",
            name="创业板ETF易方达",
            candle_time=candle_time,
            volume=1_500_000,
            prev_volume=1_000_000,
            ratio=1.5,
            threshold=1.3,
            severity="warning",
            message="159915.SZ 15分钟成交额放大 1.50 倍",
        )
    )

    store.save_candles(
        [
            candle("2026-07-21T09:45:00", 10_000, amount=1_000_000),
            candle("2026-07-21T10:00:00", 20_000, amount=1_500_000),
        ]
    )

    [saved_alert] = store.list_alerts("159915.SZ", limit=10)

    assert saved_alert.volume == 1_500_000
    assert saved_alert.prev_volume == 1_000_000
    assert saved_alert.ratio == 1.5
    assert "成交额放大" in saved_alert.message


def test_store_removes_alert_when_final_amount_no_longer_meets_threshold(tmp_path):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-08-07T11:00:00")
    store.save_alert(
        AlertCreate(
            symbol="159915.SZ",
            name="ETF A",
            candle_time=candle_time,
            volume=4_480_932,
            prev_volume=2_076_972,
            ratio=2.16,
            threshold=1.3,
            severity="warning",
            message="partial candle false positive",
        )
    )

    store.save_candles(
        [
            candle("2026-08-07T10:45:00", 128_894_000, amount=465_143_262),
            candle("2026-08-07T11:00:00", 114_719_600, amount=413_254_705),
        ]
    )

    assert store.list_alerts("159915.SZ", limit=10) == []


def test_store_syncs_first_candle_alert_against_previous_trading_day_same_slot(
    tmp_path,
):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-07-21T09:45:00")
    store.save_alert(alert(candle_time))

    store.save_candles(
        [
            candle("2026-07-20T09:45:00", 100),
            candle("2026-07-20T15:00:00", 10_000),
            candle("2026-07-21T09:45:00", 1000),
        ]
    )

    [saved_alert] = store.list_alerts("159915.SZ", limit=10)

    assert saved_alert.volume == 1000
    assert saved_alert.prev_volume == 100
    assert saved_alert.ratio == 10.0


def test_store_syncs_afternoon_open_alert_against_previous_trading_day_same_slot(
    tmp_path,
):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-07-21T13:15:00")
    store.save_alert(alert(candle_time))

    store.save_candles(
        [
            candle("2026-07-20T11:30:00", 100),
            candle("2026-07-20T13:15:00", 1000),
            candle("2026-07-21T11:30:00", 200),
            candle("2026-07-21T13:15:00", 3600),
        ]
    )

    [saved_alert] = store.list_alerts("159915.SZ", limit=10)

    assert saved_alert.volume == 3600
    assert saved_alert.prev_volume == 1000
    assert saved_alert.ratio == 3.6


def test_store_syncs_late_session_start_alert_against_same_day_previous_15m_candle(
    tmp_path,
):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-07-21T14:30:00")
    store.save_alert(alert(candle_time))

    store.save_candles(
        [
            candle("2026-07-20T14:30:00", 900),
            candle("2026-07-21T14:15:00", 100),
            candle("2026-07-21T14:30:00", 1800),
        ]
    )

    [saved_alert] = store.list_alerts("159915.SZ", limit=10)

    assert saved_alert.volume == 1800
    assert saved_alert.prev_volume == 100
    assert saved_alert.ratio == 18.0


def test_store_syncs_regular_alert_against_previous_day_same_slot_when_intraday_ratio_misses_threshold(
    tmp_path,
):
    store = AlertStore(tmp_path / "alerts.db")
    candle_time = datetime.fromisoformat("2026-07-29T10:15:00")
    store.save_alert(
        AlertCreate(
            symbol="159915.SZ",
            name="创业板ETF易方达",
            candle_time=candle_time,
            volume=136_512_700,
            prev_volume=81_134_800,
            ratio=1.68,
            threshold=1.3,
            severity="warning",
            message="159915.SZ 15分钟成交量放大 1.68 倍",
        )
    )

    store.save_candles(
        [
            candle("2026-07-28T10:15:00", 81_134_800),
            candle("2026-07-29T10:00:00", 197_485_700),
            candle("2026-07-29T10:15:00", 136_512_700),
        ]
    )

    [saved_alert] = store.list_alerts("159915.SZ", limit=10)

    assert saved_alert.volume == 136_512_700
    assert saved_alert.prev_volume == 81_134_800
    assert saved_alert.ratio == 1.68
    assert "前一交易日10:15" in saved_alert.message
