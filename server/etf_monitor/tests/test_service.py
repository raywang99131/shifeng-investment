from datetime import datetime
import threading
import time

from app.config import EtfSymbolConfig, Settings
from app.models import Candle
from app.service import MonitorService


def candle(time: str, volume: int, symbol: str, name: str) -> Candle:
    return Candle(
        symbol=symbol,
        name=name,
        time=datetime.fromisoformat(time),
        open=1.0,
        high=1.1,
        low=0.9,
        close=1.0,
        volume=volume,
        amount=float(volume),
    )


class FakeMarketDataClient:
    def __init__(self, candles=None):
        self.candles = candles or []

    def fetch_intraday_candles(self, symbol: str) -> list[Candle]:
        return self.candles


class MustNotFetchMarketDataClient:
    def fetch_intraday_candles(self, symbol: str) -> list[Candle]:
        raise AssertionError("cached snapshot must not fetch market data")


class ConcurrencySensitiveMarketDataClient:
    def __init__(self):
        self._lock = threading.Lock()
        self._active_calls = 0
        self.max_active_calls = 0

    def fetch_intraday_candles(self, symbol: str) -> list[Candle]:
        with self._lock:
            self._active_calls += 1
            self.max_active_calls = max(self.max_active_calls, self._active_calls)
        try:
            time.sleep(0.05)
            return [
                candle("2026-07-28T09:45:00", 1000, symbol, symbol),
            ]
        finally:
            with self._lock:
                self._active_calls -= 1


def test_detect_and_save_keeps_each_symbols_volume_sequence_separate(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510300.SH", name="ETF B"),
        ],
        volume_ratio_threshold=1.5,
    )
    service = MonitorService(
        settings=settings,
        market_data_client=FakeMarketDataClient(),
        db_path=tmp_path / "alerts.db",
    )
    candles = [
        candle("2026-07-28T09:45:00", 1000, "159915.SZ", "ETF A"),
        candle("2026-07-28T09:45:00", 100_000, "510300.SH", "ETF B"),
        candle("2026-07-28T10:00:00", 2000, "159915.SZ", "ETF A"),
        candle("2026-07-28T10:00:00", 100_000, "510300.SH", "ETF B"),
    ]

    result = service._detect_and_save(candles, send_notifications=False)

    assert len(result.inserted_alerts) == 1
    alert = result.inserted_alerts[0]
    assert alert.symbol == "159915.SZ"
    assert alert.candle_time == datetime.fromisoformat("2026-07-28T10:00:00")
    assert alert.prev_volume == 1000
    assert alert.ratio == 2.0


def test_poll_all_fetches_symbols_serially(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510300.SH", name="ETF B"),
        ],
    )
    market_data_client = ConcurrencySensitiveMarketDataClient()
    service = MonitorService(
        settings=settings,
        market_data_client=market_data_client,
        db_path=tmp_path / "alerts.db",
    )

    results = service.poll_all()

    assert [result.symbol for result in results] == ["159915.SZ", "510300.SH"]
    assert market_data_client.max_active_calls == 1


def test_poll_merges_cached_history_for_previous_day_same_slot_detection(tmp_path):
    db_path = tmp_path / "alerts.db"
    settings = Settings(
        symbols=[EtfSymbolConfig(symbol="510300.SH", name="沪深300ETF华泰柏瑞")],
        volume_ratio_threshold=1.3,
        batch_notification_max_lag_seconds=10**9,
    )
    service = MonitorService(
        settings=settings,
        market_data_client=FakeMarketDataClient(),
        db_path=db_path,
    )
    service.candle_cache.upsert_candles(
        [
            candle("2026-08-11T13:30:00", 241_000_000, "510300.SH", "沪深300ETF华泰柏瑞"),
            candle("2026-08-11T13:45:00", 112_000_000, "510300.SH", "沪深300ETF华泰柏瑞"),
        ]
    )
    service.market_data_client = FakeMarketDataClient(
        [
            candle("2026-08-12T13:30:00", 241_000_000, "510300.SH", "沪深300ETF华泰柏瑞"),
            candle("2026-08-12T13:45:00", 197_000_000, "510300.SH", "沪深300ETF华泰柏瑞"),
        ]
    )

    response = service.poll("510300.SH")

    assert response.alert is not None
    assert response.alert.candle_time == datetime.fromisoformat("2026-08-12T13:45:00")
    assert response.alert.prev_volume == 112_000_000
    assert response.alert.ratio == 1.76


def test_cached_snapshot_reads_sqlite_without_market_request(tmp_path):
    settings = Settings(
        db_path=tmp_path / "monitor.db",
        scheduler_enabled=False,
    )
    service = MonitorService(
        settings=settings,
        market_data_client=MustNotFetchMarketDataClient(),
        db_path=settings.db_path,
    )
    cached_candle = candle(
        "2026-08-12T10:00:00",
        12_000_000,
        "159915.SZ",
        "创业板ETF易方达",
    )
    service.candle_cache.upsert_candles([cached_candle])

    snapshot = service.cached_snapshot("159915.SZ")

    assert snapshot.data_status == "cached"
    assert snapshot.latest_candle == cached_candle
    assert snapshot.error is None
