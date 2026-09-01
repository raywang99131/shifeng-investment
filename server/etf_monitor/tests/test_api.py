from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app import service as service_module
from app.config import EtfSymbolConfig, Settings
from app.main import create_app
from app.models import Candle
from app.store import AlertStore
from app.trading_calendar import TradingDayResolution


def candle(
    time: str,
    volume: int,
    symbol: str = "159915.SZ",
    name: str = "创业板ETF易方达",
) -> Candle:
    return Candle(
        symbol=symbol,
        name=name,
        time=datetime.fromisoformat(time),
        open=1.0,
        high=1.1,
        low=0.9,
        close=1.05,
        volume=volume,
        amount=volume * 1.0,
    )


def prior_day_candles(
    symbol: str = "159915.SZ",
    name: str = "创业板ETF易方达",
    volume: int = 1000,
    dates: tuple[str, ...] = ("2026-07-15", "2026-07-16", "2026-07-17"),
) -> list[Candle]:
    return [
        candle(f"{date}T{time}", volume, symbol=symbol, name=name)
        for date in dates
        for time in ("09:45:00", "10:00:00")
    ]


class FakeMarketDataClient:
    def __init__(self, candles=None, error=None):
        self.candles = candles or []
        self.error = error

    def fetch_intraday_candles(self, symbol: str):
        if self.error:
            raise self.error
        return self.candles


class MustNotFetchMarketDataClient:
    def fetch_intraday_candles(self, symbol: str):
        raise AssertionError("cached snapshot must not fetch market data")


class StaticTradingCalendar:
    def resolve(self, target_date: date) -> TradingDayResolution:
        return TradingDayResolution(True, "confirmed")


class SymbolAwareMarketDataClient:
    def __init__(self, candles_by_symbol=None):
        self.calls = []
        self.candles_by_symbol = candles_by_symbol or {}

    def fetch_intraday_candles(self, symbol: str):
        self.calls.append(symbol)
        if symbol in self.candles_by_symbol:
            return self.candles_by_symbol[symbol]
        names = {
            "159915.SZ": "创业板ETF易方达",
            "510310.SH": "沪深300ETF易方达",
            "588080.SH": "科创50ETF易方达",
        }
        return [
            candle("2026-07-20T09:45:00", 1000, symbol=symbol, name=names[symbol]),
            candle("2026-07-20T10:00:00", 1200, symbol=symbol, name=names[symbol]),
        ]


class StatefulMarketDataClient:
    def __init__(self, snapshots_by_symbol):
        self.calls_by_symbol = {}
        self.snapshots_by_symbol = snapshots_by_symbol

    def fetch_intraday_candles(self, symbol: str):
        call_count = self.calls_by_symbol.get(symbol, 0)
        self.calls_by_symbol[symbol] = call_count + 1
        snapshots = self.snapshots_by_symbol[symbol]
        return snapshots[min(call_count, len(snapshots) - 1)]


class SymbolErrorMarketDataClient:
    def __init__(self, candles_by_symbol=None, error_symbols=None):
        self.candles_by_symbol = candles_by_symbol or {}
        self.error_symbols = set(error_symbols or [])

    def fetch_intraday_candles(self, symbol: str):
        if symbol in self.error_symbols:
            raise RuntimeError("market data unavailable")
        return self.candles_by_symbol[symbol]


class RecordingNotifier:
    def __init__(self):
        self.alerts = []
        self.alert_batches = []
        self.no_anomaly_notifications = []
        self.no_anomaly_batches = []
        self.daily_summaries = []

    def send_alert(self, alert):
        self.alerts.append(alert)

    def send_alerts(self, alerts):
        self.alert_batches.append(list(alerts))

    def send_no_anomaly(self, candle, notified_at):
        self.no_anomaly_notifications.append((candle, notified_at))

    def send_no_anomalies(self, candles, notified_at):
        self.no_anomaly_batches.append((list(candles), notified_at))

    def send_daily_summary(self, summary_date, symbols, alerts, notified_at):
        self.daily_summaries.append(
            (summary_date, list(symbols), list(alerts), notified_at)
        )


def test_poll_creates_alert_and_snapshot_returns_current_alert(tmp_path):
    market_data = FakeMarketDataClient(
        candles=prior_day_candles()
        + [
            candle("2026-07-20T09:45:00", 1000),
            candle("2026-07-20T10:00:00", 1000),
            candle("2026-07-20T10:15:00", 1000),
            candle("2026-07-20T10:30:00", 1000),
            candle("2026-07-20T10:45:00", 1000),
            candle("2026-07-20T11:00:00", 1000),
            candle("2026-07-20T11:15:00", 1000),
            candle("2026-07-20T11:30:00", 1000),
            candle("2026-07-20T13:15:00", 1000),
            candle("2026-07-20T13:30:00", 3600),
        ]
    )
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
    )
    client = TestClient(app)

    poll_response = client.post("/api/monitor/poll")
    snapshot_response = client.get("/api/monitor/snapshot?symbol=159915.SZ")
    alerts_response = client.get("/api/alerts?symbol=159915.SZ&limit=100")

    assert poll_response.status_code == 200
    assert poll_response.json()["alert"]["severity"] == "warning"
    assert snapshot_response.status_code == 200
    assert snapshot_response.json()["current_alert"]["severity"] == "warning"
    assert snapshot_response.json()["latest_candle"]["volume"] == 3600
    assert snapshot_response.json()["last_updated"] == "2026-07-20T13:30:00"
    assert alerts_response.status_code == 200
    assert len(alerts_response.json()["alerts"]) == 1


def test_symbols_endpoint_returns_configured_etfs(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="创业板ETF易方达"),
            EtfSymbolConfig(symbol="510310.SH", name="沪深300ETF易方达"),
            EtfSymbolConfig(symbol="588080.SH", name="科创50ETF易方达"),
        ]
    )
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=FakeMarketDataClient(),
        scheduler_enabled=False,
        settings=settings,
    )
    client = TestClient(app)

    response = client.get("/api/monitor/symbols")

    assert response.status_code == 200
    assert response.json()["symbols"] == [
        {"symbol": "159915.SZ", "name": "创业板ETF易方达"},
        {"symbol": "510310.SH", "name": "沪深300ETF易方达"},
        {"symbol": "588080.SH", "name": "科创50ETF易方达"},
    ]


def test_health_exposes_scheduler_market_phase(tmp_path):
    shanghai = ZoneInfo("Asia/Shanghai")
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=FakeMarketDataClient(),
        scheduler_enabled=False,
        trading_calendar=StaticTradingCalendar(),
        scheduler_now=lambda: datetime(2026, 8, 12, 11, 45, tzinfo=shanghai),
    )
    app.state.poll_scheduler.run_once()

    response = TestClient(app).get("/api/health")

    assert response.status_code == 200
    scheduler = response.json()["scheduler"]
    assert scheduler["enabled"] is False
    assert scheduler["phase"] == "lunch_break"
    assert scheduler["should_poll"] is False
    assert scheduler["monitoring_active"] is False
    assert scheduler["calendar_quality"] == "confirmed"
    assert "last_poll_attempt" in scheduler
    assert "last_poll_success" in scheduler


def test_poll_all_polls_every_configured_symbol(tmp_path):
    market_data = SymbolAwareMarketDataClient()
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="创业板ETF易方达"),
            EtfSymbolConfig(symbol="510310.SH", name="沪深300ETF易方达"),
            EtfSymbolConfig(symbol="588080.SH", name="科创50ETF易方达"),
        ]
    )
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
    )
    client = TestClient(app)

    response = client.post("/api/monitor/poll-all")

    assert response.status_code == 200
    assert market_data.calls == ["159915.SZ", "510310.SH", "588080.SH"]
    assert [item["symbol"] for item in response.json()["results"]] == [
        "159915.SZ",
        "510310.SH",
        "588080.SH",
    ]


def test_poll_all_sends_new_alerts_in_one_batch_and_excludes_normal_symbols(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="创业板ETF易方达"),
            EtfSymbolConfig(symbol="510310.SH", name="沪深300ETF易方达"),
        ]
    )
    market_data = SymbolAwareMarketDataClient(
        candles_by_symbol={
            "159915.SZ": prior_day_candles()
            + [
                candle("2026-07-21T09:45:00", 1000),
                candle("2026-07-21T10:00:00", 1000),
                candle("2026-07-21T10:15:00", 1000),
                candle("2026-07-21T10:30:00", 1000),
                candle("2026-07-21T10:45:00", 1000),
                candle("2026-07-21T11:00:00", 1000),
                candle("2026-07-21T11:15:00", 1000),
                candle("2026-07-21T11:30:00", 1000),
                candle("2026-07-21T13:15:00", 1000),
                candle("2026-07-21T13:30:00", 3600),
            ],
            "510310.SH": prior_day_candles(symbol="510310.SH", name="沪深300ETF易方达")
            + [
                candle("2026-07-21T09:45:00", 1000, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T10:00:00", 1100, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T10:15:00", 1000, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T10:30:00", 1100, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T10:45:00", 1000, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T11:00:00", 1100, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T11:15:00", 1000, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T11:30:00", 1100, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T13:15:00", 1000, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T13:30:00", 1100, "510310.SH", "沪深300ETF易方达"),
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    response = client.post("/api/monitor/poll-all")

    assert response.status_code == 200
    assert notifier.alerts == []
    assert len(notifier.alert_batches) == 1
    assert [alert.symbol for alert in notifier.alert_batches[0]] == ["159915.SZ"]
    assert notifier.no_anomaly_notifications == []
    assert notifier.no_anomaly_batches == []


def test_poll_all_sends_same_round_alerts_in_one_email(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="588000.SH", name="绉戝垱50ETF鍗庡"),
            EtfSymbolConfig(symbol="159915.SZ", name="鍒涗笟鏉縀TF鏄撴柟杈?"),
            EtfSymbolConfig(symbol="510300.SH", name="娌繁300ETF鍗庢嘲鏌忕憺"),
        ]
    )

    def prior_quote(symbol: str, name: str) -> list:
        return [candle("2026-07-20T09:45:00", 100, symbol=symbol, name=name)]

    def new_quote(symbol: str, name: str, volume: int) -> list:
        return prior_quote(symbol, name) + [
            candle("2026-07-21T09:30:00", 100, symbol=symbol, name=name),
            candle("2026-07-21T09:45:00", volume, symbol=symbol, name=name),
        ]

    market_data = StatefulMarketDataClient(
        {
            "588000.SH": [
                prior_quote("588000.SH", "绉戝垱50ETF鍗庡"),
                new_quote("588000.SH", "绉戝垱50ETF鍗庡", 400),
            ],
            "159915.SZ": [
                prior_quote("159915.SZ", "鍒涗笟鏉縀TF鏄撴柟杈?"),
                new_quote("159915.SZ", "鍒涗笟鏉縀TF鏄撴柟杈?", 350),
            ],
            "510300.SH": [
                prior_quote("510300.SH", "娌繁300ETF鍗庢嘲鏌忕憺"),
                new_quote("510300.SH", "娌繁300ETF鍗庢嘲鏌忕憺", 300),
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    first_response = client.post("/api/monitor/poll-all")
    second_response = client.post("/api/monitor/poll-all")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert len(notifier.alert_batches) == 1
    assert sorted(alert.symbol for alert in notifier.alert_batches[0]) == sorted([
        "588000.SH",
        "159915.SZ",
        "510300.SH",
    ])
    assert all(
        alert.candle_time == datetime.fromisoformat("2026-07-21T09:45:00")
        for alert in notifier.alert_batches[0]
    )


def test_poll_all_sends_normal_symbols_in_one_no_anomaly_batch(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="创业板ETF易方达"),
            EtfSymbolConfig(symbol="510310.SH", name="沪深300ETF易方达"),
        ]
    )
    market_data = SymbolAwareMarketDataClient(
        candles_by_symbol={
            "159915.SZ": prior_day_candles()
            + [
                candle("2026-07-21T09:45:00", 1000),
                candle("2026-07-21T10:00:00", 1100),
            ],
            "510310.SH": prior_day_candles(symbol="510310.SH", name="沪深300ETF易方达")
            + [
                candle("2026-07-21T09:45:00", 1000, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T10:00:00", 1100, "510310.SH", "沪深300ETF易方达"),
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    first_response = client.post("/api/monitor/poll-all")
    second_response = client.post("/api/monitor/poll-all")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert notifier.alert_batches == []
    assert len(notifier.no_anomaly_batches) == 1
    candles, notified_at = notifier.no_anomaly_batches[0]
    assert [item.symbol for item in candles] == ["159915.SZ", "510310.SH"]
    assert all(
        item.time == datetime.fromisoformat("2026-07-21T10:00:00") for item in candles
    )
    assert notified_at.tzinfo is not None


def test_poll_all_sends_late_alert_after_legacy_no_anomaly_batch(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510310.SH", name="ETF B"),
        ]
    )
    alert_time = datetime.fromisoformat("2026-07-21T10:30:00")
    market_data = StatefulMarketDataClient(
        {
            "159915.SZ": [
                [
                    candle("2026-07-21T10:15:00", 1000, "159915.SZ", "ETF A"),
                    candle("2026-07-21T10:30:00", 1100, "159915.SZ", "ETF A"),
                ],
                [
                    candle("2026-07-21T10:15:00", 1000, "159915.SZ", "ETF A"),
                    candle("2026-07-21T10:30:00", 1500, "159915.SZ", "ETF A"),
                ],
            ],
            "510310.SH": [
                [
                    candle("2026-07-21T10:15:00", 1000, "510310.SH", "ETF B"),
                    candle("2026-07-21T10:30:00", 1100, "510310.SH", "ETF B"),
                ],
                [
                    candle("2026-07-21T10:15:00", 1000, "510310.SH", "ETF B"),
                    candle("2026-07-21T10:30:00", 1100, "510310.SH", "ETF B"),
                ],
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    first_response = client.post("/api/monitor/poll-all")
    app.state.monitor_service.alert_store.save_notification_event_with_status(
        symbol=service_module.ALERT_BATCH_SYMBOL,
        candle_time=alert_time,
        event_type="alert_batch",
    )
    with app.state.monitor_service.alert_store._connect() as connection:
        connection.execute(
            """
            UPDATE notification_events
            SET created_at = '2026-07-21 02:00:00'
            WHERE symbol = ? AND candle_time = ? AND event_type = 'alert_batch'
            """,
            (service_module.ALERT_BATCH_SYMBOL, alert_time.isoformat()),
        )
    second_response = client.post("/api/monitor/poll-all")
    third_response = client.post("/api/monitor/poll-all")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert third_response.status_code == 200
    assert len(notifier.no_anomaly_batches) == 1
    assert len(notifier.alert_batches) == 1
    assert [alert.symbol for alert in notifier.alert_batches[0]] == ["159915.SZ"]
    assert notifier.alert_batches[0][0].candle_time == alert_time


def test_poll_all_waits_before_sending_no_anomaly_then_sends_late_alert(
    monkeypatch, tmp_path
):
    class FrozenDateTime(datetime):
        current = datetime(2026, 7, 21, 10, 31)

        @classmethod
        def now(cls, tz=None):
            return cls.current.replace(tzinfo=tz)

    monkeypatch.setattr(service_module, "datetime", FrozenDateTime)
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510310.SH", name="ETF B"),
        ],
        no_anomaly_confirmation_delay_seconds=240,
    )
    alert_time = datetime.fromisoformat("2026-07-21T10:30:00")
    market_data = StatefulMarketDataClient(
        {
            "159915.SZ": [
                [
                    candle("2026-07-21T10:15:00", 1000, "159915.SZ", "ETF A"),
                    candle("2026-07-21T10:30:00", 1100, "159915.SZ", "ETF A"),
                ],
                [
                    candle("2026-07-21T10:15:00", 1000, "159915.SZ", "ETF A"),
                    candle("2026-07-21T10:30:00", 1500, "159915.SZ", "ETF A"),
                ],
            ],
            "510310.SH": [
                [
                    candle("2026-07-21T10:15:00", 1000, "510310.SH", "ETF B"),
                    candle("2026-07-21T10:30:00", 1100, "510310.SH", "ETF B"),
                ],
                [
                    candle("2026-07-21T10:15:00", 1000, "510310.SH", "ETF B"),
                    candle("2026-07-21T10:30:00", 1100, "510310.SH", "ETF B"),
                ],
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    first_response = client.post("/api/monitor/poll-all")
    FrozenDateTime.current = datetime(2026, 7, 21, 10, 32)
    second_response = client.post("/api/monitor/poll-all")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert notifier.no_anomaly_batches == []
    assert len(notifier.alert_batches) == 1
    assert [alert.symbol for alert in notifier.alert_batches[0]] == ["159915.SZ"]
    assert notifier.alert_batches[0][0].candle_time == alert_time


def test_poll_all_does_not_resend_late_alert_after_current_alert_batch(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510310.SH", name="ETF B"),
        ]
    )
    alert_time = datetime.fromisoformat("2026-07-21T10:30:00")
    market_data = StatefulMarketDataClient(
        {
            "159915.SZ": [
                [
                    candle("2026-07-21T10:15:00", 1000, "159915.SZ", "ETF A"),
                    candle("2026-07-21T10:30:00", 1100, "159915.SZ", "ETF A"),
                ],
                [
                    candle("2026-07-21T10:15:00", 1000, "159915.SZ", "ETF A"),
                    candle("2026-07-21T10:30:00", 1500, "159915.SZ", "ETF A"),
                ],
            ],
            "510310.SH": [
                [
                    candle("2026-07-21T10:15:00", 1000, "510310.SH", "ETF B"),
                    candle("2026-07-21T10:30:00", 1100, "510310.SH", "ETF B"),
                ],
                [
                    candle("2026-07-21T10:15:00", 1000, "510310.SH", "ETF B"),
                    candle("2026-07-21T10:30:00", 1100, "510310.SH", "ETF B"),
                ],
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    first_response = client.post("/api/monitor/poll-all")
    second_response = client.post("/api/monitor/poll-all")
    third_response = client.post("/api/monitor/poll-all")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert third_response.status_code == 200
    assert len(notifier.no_anomaly_batches) == 1
    assert len(notifier.alert_batches) == 1
    assert notifier.alert_batches[0][0].candle_time == alert_time


def test_poll_all_does_not_send_stale_alert_batch_after_restart(monkeypatch, tmp_path):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 7, 21, 13, 13, tzinfo=tz)

    monkeypatch.setattr(service_module, "datetime", FrozenDateTime)
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510310.SH", name="ETF B"),
        ],
        batch_notification_max_lag_seconds=900,
    )
    market_data = SymbolAwareMarketDataClient(
        candles_by_symbol={
            "159915.SZ": [
                candle("2026-07-21T11:15:00", 1000, "159915.SZ", "ETF A"),
                candle("2026-07-21T11:30:00", 1800, "159915.SZ", "ETF A"),
            ],
            "510310.SH": [
                candle("2026-07-21T11:15:00", 1000, "510310.SH", "ETF B"),
                candle("2026-07-21T11:30:00", 1000, "510310.SH", "ETF B"),
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    response = client.post("/api/monitor/poll-all")

    assert response.status_code == 200
    assert notifier.alert_batches == []
    assert notifier.no_anomaly_batches == []


def test_poll_all_does_not_wait_for_delayed_first_candle_before_it_is_due(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510300.SH", name="ETF B"),
            EtfSymbolConfig(symbol="513310.SH", name="ETF C"),
        ],
        symbol_first_candle_times={"513310.SH": time(10, 45)},
    )
    market_data = SymbolAwareMarketDataClient(
        candles_by_symbol={
            "159915.SZ": prior_day_candles(symbol="159915.SZ", name="ETF A")
            + [
                candle("2026-07-21T09:45:00", 1000, "159915.SZ", "ETF A"),
                candle("2026-07-21T10:00:00", 1100, "159915.SZ", "ETF A"),
            ],
            "510300.SH": prior_day_candles(symbol="510300.SH", name="ETF B")
            + [
                candle("2026-07-21T09:45:00", 1000, "510300.SH", "ETF B"),
                candle("2026-07-21T10:00:00", 1100, "510300.SH", "ETF B"),
            ],
            "513310.SH": [
                candle("2026-07-20T14:45:00", 1000, "513310.SH", "ETF C"),
                candle("2026-07-20T15:00:00", 1100, "513310.SH", "ETF C"),
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    response = client.post("/api/monitor/poll-all")

    assert response.status_code == 200
    assert notifier.alert_batches == []
    assert len(notifier.no_anomaly_batches) == 1
    candles, _ = notifier.no_anomaly_batches[0]
    assert [item.symbol for item in candles] == ["159915.SZ", "510300.SH"]
    assert all(
        item.time == datetime.fromisoformat("2026-07-21T10:00:00")
        for item in candles
    )


def test_poll_all_ignores_delayed_symbol_error_before_its_first_candle_is_due(
    tmp_path,
):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510300.SH", name="ETF B"),
            EtfSymbolConfig(symbol="513310.SH", name="ETF C"),
        ],
        symbol_first_candle_times={"513310.SH": time(10, 45)},
    )
    market_data = SymbolErrorMarketDataClient(
        candles_by_symbol={
            "159915.SZ": prior_day_candles(symbol="159915.SZ", name="ETF A")
            + [
                candle("2026-07-21T09:45:00", 1000, "159915.SZ", "ETF A"),
                candle("2026-07-21T10:00:00", 1100, "159915.SZ", "ETF A"),
            ],
            "510300.SH": prior_day_candles(symbol="510300.SH", name="ETF B")
            + [
                candle("2026-07-21T09:45:00", 1000, "510300.SH", "ETF B"),
                candle("2026-07-21T10:00:00", 1100, "510300.SH", "ETF B"),
            ],
        },
        error_symbols={"513310.SH"},
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    response = client.post("/api/monitor/poll-all")

    assert response.status_code == 200
    assert len(notifier.no_anomaly_batches) == 1
    candles, _ = notifier.no_anomaly_batches[0]
    assert [item.symbol for item in candles] == ["159915.SZ", "510300.SH"]


def test_poll_all_waits_for_delayed_symbol_after_its_first_candle_is_due(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510300.SH", name="ETF B"),
            EtfSymbolConfig(symbol="513310.SH", name="ETF C"),
        ],
        symbol_first_candle_times={"513310.SH": time(10, 45)},
    )
    market_data = SymbolAwareMarketDataClient(
        candles_by_symbol={
            "159915.SZ": prior_day_candles(symbol="159915.SZ", name="ETF A")
            + [
                candle("2026-07-21T10:30:00", 1000, "159915.SZ", "ETF A"),
                candle("2026-07-21T10:45:00", 1100, "159915.SZ", "ETF A"),
            ],
            "510300.SH": prior_day_candles(symbol="510300.SH", name="ETF B")
            + [
                candle("2026-07-21T10:30:00", 1000, "510300.SH", "ETF B"),
                candle("2026-07-21T10:45:00", 1100, "510300.SH", "ETF B"),
            ],
            "513310.SH": [
                candle("2026-07-20T14:45:00", 1000, "513310.SH", "ETF C"),
                candle("2026-07-20T15:00:00", 1100, "513310.SH", "ETF C"),
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    response = client.post("/api/monitor/poll-all")

    assert response.status_code == 200
    assert notifier.alert_batches == []
    assert notifier.no_anomaly_batches == []


def test_poll_all_sends_daily_summary_after_close_once_even_without_alerts(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="创业板ETF易方达"),
            EtfSymbolConfig(symbol="510310.SH", name="沪深300ETF易方达"),
        ]
    )
    market_data = SymbolAwareMarketDataClient(
        candles_by_symbol={
            "159915.SZ": prior_day_candles()
            + [
                candle("2026-07-21T14:45:00", 1000),
                candle("2026-07-21T15:00:00", 1100),
            ],
            "510310.SH": prior_day_candles(symbol="510310.SH", name="沪深300ETF易方达")
            + [
                candle("2026-07-21T14:45:00", 1000, "510310.SH", "沪深300ETF易方达"),
                candle("2026-07-21T15:00:00", 1100, "510310.SH", "沪深300ETF易方达"),
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    first_response = client.post("/api/monitor/poll-all")
    second_response = client.post("/api/monitor/poll-all")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert len(notifier.daily_summaries) == 1
    summary_date, symbols, alerts, notified_at = notifier.daily_summaries[0]
    assert summary_date.isoformat() == "2026-07-21"
    assert [item.symbol for item in symbols] == ["159915.SZ", "510310.SH"]
    assert alerts == []
    assert notified_at.tzinfo is not None


def test_poll_all_excludes_early_rule_change_alert_from_daily_summary(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="ETF A"),
            EtfSymbolConfig(symbol="510310.SH", name="ETF B"),
        ]
    )
    market_data = SymbolAwareMarketDataClient(
        candles_by_symbol={
            "159915.SZ": prior_day_candles()
            + [
                candle("2026-07-21T09:45:00", 4000),
                candle("2026-07-21T10:00:00", 12000),
                candle("2026-07-21T10:15:00", 12000),
                candle("2026-07-21T14:45:00", 12000),
                candle("2026-07-21T15:00:00", 12000),
            ],
            "510310.SH": prior_day_candles(symbol="510310.SH", name="ETF B")
            + [
                candle("2026-07-21T09:45:00", 1000, "510310.SH", "ETF B"),
                candle("2026-07-21T10:00:00", 1000, "510310.SH", "ETF B"),
                candle("2026-07-21T10:15:00", 1000, "510310.SH", "ETF B"),
                candle("2026-07-21T14:45:00", 1000, "510310.SH", "ETF B"),
                candle("2026-07-21T15:00:00", 1000, "510310.SH", "ETF B"),
            ],
        }
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    response = client.post("/api/monitor/poll-all")

    assert response.status_code == 200
    assert len(notifier.daily_summaries) == 1
    _, _, alerts, _ = notifier.daily_summaries[0]
    assert [alert.candle_time for alert in alerts] == [
        datetime.fromisoformat("2026-07-21T10:00:00")
    ]


def test_snapshot_uses_configured_name_for_selected_symbol(tmp_path):
    settings = Settings(
        symbols=[
            EtfSymbolConfig(symbol="159915.SZ", name="创业板ETF易方达"),
            EtfSymbolConfig(symbol="510310.SH", name="沪深300ETF易方达"),
        ]
    )
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=SymbolAwareMarketDataClient(),
        scheduler_enabled=False,
        settings=settings,
    )
    client = TestClient(app)

    response = client.get("/api/monitor/snapshot?symbol=510310.SH")

    assert response.status_code == 200
    assert response.json()["symbol"] == "510310.SH"
    assert response.json()["name"] == "沪深300ETF易方达"


def test_poll_detects_intraday_spike_even_when_latest_candle_is_normal(tmp_path):
    symbol = "510310.SH"
    name = "沪深300ETF易方达"
    market_data = FakeMarketDataClient(
        candles=prior_day_candles(
            symbol=symbol,
            name=name,
            volume=30_000_000,
            dates=("2026-07-16", "2026-07-17", "2026-07-20"),
        )
        + [
            candle("2026-07-21T09:45:00", 50_000_000, symbol=symbol, name=name),
            candle("2026-07-21T10:00:00", 48_558_850, symbol=symbol, name=name),
            candle("2026-07-21T10:15:00", 37_753_800, symbol=symbol, name=name),
            candle("2026-07-21T10:30:00", 29_947_193, symbol=symbol, name=name),
            candle("2026-07-21T10:45:00", 40_176_349, symbol=symbol, name=name),
            candle("2026-07-21T11:00:00", 90_000_000, symbol=symbol, name=name),
            candle("2026-07-21T11:15:00", 95_000_000, symbol=symbol, name=name),
        ]
    )
    settings = Settings(
        opening_volume_ratio_threshold=2.0,
        volume_ratio_threshold=2.0,
        late_session_volume_ratio_threshold=2.0,
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    poll_response = client.post(f"/api/monitor/poll?symbol={symbol}")
    alerts_response = client.get(f"/api/alerts?symbol={symbol}&limit=100")

    assert poll_response.status_code == 200
    assert alerts_response.status_code == 200
    alerts = alerts_response.json()["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["alert_type"] == "volume_spike"
    assert alerts[0]["candle_time"] == "2026-07-21T11:00:00"
    assert alerts[0]["ratio"] == 2.24
    assert alerts[0]["volume"] == 90_000_000
    assert alerts[0]["prev_volume"] == 40_176_349
    assert len(notifier.alerts) == 1
    assert notifier.alerts[0].candle_time == datetime.fromisoformat(
        "2026-07-21T11:00:00"
    )
    assert notifier.no_anomaly_notifications == []


def test_poll_ignores_intraday_shrink_and_sends_no_anomaly_for_latest_candle(tmp_path):
    symbol = "510310.SH"
    name = "沪深300ETF易方达"
    market_data = FakeMarketDataClient(
        candles=prior_day_candles(
            symbol=symbol,
            name=name,
            volume=30_000_000,
            dates=("2026-07-16", "2026-07-17", "2026-07-20"),
        )
        + [
            candle("2026-07-21T09:45:00", 50_000_000, symbol=symbol, name=name),
            candle("2026-07-21T10:00:00", 48_558_850, symbol=symbol, name=name),
            candle("2026-07-21T10:15:00", 37_753_800, symbol=symbol, name=name),
            candle("2026-07-21T10:30:00", 29_947_193, symbol=symbol, name=name),
            candle("2026-07-21T10:45:00", 40_176_349, symbol=symbol, name=name),
            candle("2026-07-21T11:00:00", 17_418_272, symbol=symbol, name=name),
            candle("2026-07-21T11:15:00", 20_000_000, symbol=symbol, name=name),
        ]
    )
    settings = Settings(
        opening_volume_ratio_threshold=2.0,
        volume_ratio_threshold=2.0,
        late_session_volume_ratio_threshold=2.0,
        volume_shrink_ratio_threshold=0.4,
        median_shrink_multiplier_threshold=0,
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        settings=settings,
        notifier=notifier,
    )
    client = TestClient(app)

    poll_response = client.post(f"/api/monitor/poll?symbol={symbol}")
    alerts_response = client.get(f"/api/alerts?symbol={symbol}&limit=100")

    assert poll_response.status_code == 200
    assert poll_response.json()["alert"] is None
    assert alerts_response.status_code == 200
    assert alerts_response.json()["alerts"] == []
    assert notifier.alerts == []
    assert len(notifier.no_anomaly_notifications) == 1
    assert notifier.no_anomaly_notifications[0][0].time == datetime.fromisoformat(
        "2026-07-21T11:15:00"
    )


def test_poll_sends_no_anomaly_notification_once_for_latest_candle(tmp_path):
    market_data = FakeMarketDataClient(
        candles=prior_day_candles()
        + [
            candle("2026-07-20T09:45:00", 1000),
            candle("2026-07-20T10:00:00", 1100),
            candle("2026-07-20T10:15:00", 1050),
        ]
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        notifier=notifier,
    )
    client = TestClient(app)

    first_response = client.post("/api/monitor/poll")
    second_response = client.post("/api/monitor/poll")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json()["alert"] is None
    assert second_response.json()["alert"] is None
    assert notifier.alerts == []
    assert len(notifier.no_anomaly_notifications) == 1
    latest_candle, notified_at = notifier.no_anomaly_notifications[0]
    assert latest_candle.symbol == "159915.SZ"
    assert latest_candle.name == "创业板ETF易方达"
    assert latest_candle.time == datetime.fromisoformat("2026-07-20T10:15:00")
    assert notified_at.tzinfo is not None


def test_poll_sends_notification_only_for_new_alerts(tmp_path):
    market_data = FakeMarketDataClient(
        candles=prior_day_candles()
        + [
            candle("2026-07-20T09:45:00", 1000),
            candle("2026-07-20T10:00:00", 1000),
            candle("2026-07-20T10:15:00", 1000),
            candle("2026-07-20T10:30:00", 1000),
            candle("2026-07-20T10:45:00", 1000),
            candle("2026-07-20T11:00:00", 1000),
            candle("2026-07-20T11:15:00", 1000),
            candle("2026-07-20T11:30:00", 1000),
            candle("2026-07-20T13:15:00", 1000),
            candle("2026-07-20T13:30:00", 3600),
        ]
    )
    notifier = RecordingNotifier()
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=market_data,
        scheduler_enabled=False,
        notifier=notifier,
    )
    client = TestClient(app)

    first_response = client.post("/api/monitor/poll")
    second_response = client.post("/api/monitor/poll")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert len(notifier.alerts) == 1
    assert notifier.alerts[0].symbol == "159915.SZ"
    assert notifier.alerts[0].candle_time == datetime.fromisoformat(
        "2026-07-20T13:30:00"
    )
    assert notifier.no_anomaly_notifications == []


def test_snapshot_uses_cached_candles_when_market_data_source_fails(tmp_path):
    db_path = tmp_path / "alerts.db"
    healthy_app = create_app(
        db_path=db_path,
        market_data_client=FakeMarketDataClient(
            candles=[
                candle("2026-07-20T09:45:00", 1000),
                candle("2026-07-20T10:00:00", 1200),
            ]
        ),
        scheduler_enabled=False,
    )
    TestClient(healthy_app).post("/api/monitor/poll")

    degraded_app = create_app(
        db_path=db_path,
        market_data_client=FakeMarketDataClient(error=RuntimeError("akshare failed")),
        scheduler_enabled=False,
    )
    client = TestClient(degraded_app)

    response = client.get("/api/monitor/snapshot?symbol=159915.SZ")

    assert response.status_code == 200
    body = response.json()
    assert body["data_status"] == "cached"
    assert body["error"] == "akshare failed"
    assert body["current_alert"] is None
    assert body["latest_candle"]["volume"] == 1200
    assert body["last_updated"] == "2026-07-20T10:00:00"
    assert len(body["candles"]) == 2


def test_cached_snapshot_endpoint_never_calls_market_data(tmp_path):
    db_path = tmp_path / "monitor.db"
    store = AlertStore(db_path)
    store.upsert_candles([
        candle("2026-08-12T10:00:00", 12_000_000),
    ])
    app = create_app(
        db_path=db_path,
        market_data_client=MustNotFetchMarketDataClient(),
        scheduler_enabled=False,
    )

    with TestClient(app) as client:
        response = client.get(
            "/api/monitor/cached-snapshot?symbol=159915.SZ"
        )

    assert response.status_code == 200
    assert response.json()["data_status"] == "cached"
    assert response.json()["latest_candle"]["amount"] == 12_000_000


def test_snapshot_returns_only_latest_trading_day_candles(tmp_path):
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=FakeMarketDataClient(
            candles=[
                candle("2026-07-17T14:45:00", 900),
                candle("2026-07-17T15:00:00", 950),
                candle("2026-07-20T09:45:00", 1000),
                candle("2026-07-20T10:00:00", 1200),
            ]
        ),
        scheduler_enabled=False,
    )
    client = TestClient(app)

    response = client.get("/api/monitor/snapshot?symbol=159915.SZ")

    assert response.status_code == 200
    body = response.json()
    assert [item["time"] for item in body["candles"]] == [
        "2026-07-20T09:45:00",
        "2026-07-20T10:00:00",
    ]


def test_snapshot_waits_for_completion_delay_before_using_boundary_candle(
    monkeypatch, tmp_path
):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 8, 7, 11, 1, tzinfo=tz)

    monkeypatch.setattr(service_module, "datetime", FrozenDateTime)
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=FakeMarketDataClient(
            candles=[
                candle("2026-08-07T10:45:00", 465_143_262),
                candle("2026-08-07T11:00:00", 4_480_932),
            ]
        ),
        scheduler_enabled=False,
        settings=Settings(candle_completion_delay_seconds=180),
    )
    client = TestClient(app)

    response = client.get("/api/monitor/snapshot?symbol=159915.SZ")

    assert response.status_code == 200
    body = response.json()
    assert body["latest_candle"]["time"] == "2026-08-07T10:45:00"
    assert [item["time"] for item in body["candles"]] == ["2026-08-07T10:45:00"]


def test_snapshot_filters_unfinished_cached_candle_when_live_source_fails(
    monkeypatch, tmp_path
):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 8, 7, 11, 27, tzinfo=tz)

    db_path = tmp_path / "alerts.db"
    store = AlertStore(db_path)
    store.save_candles(
        [
            candle("2026-08-07T10:45:00", 465_143_262),
            candle("2026-08-07T11:30:00", 64_432_767),
        ]
    )
    monkeypatch.setattr(service_module, "datetime", FrozenDateTime)
    app = create_app(
        db_path=db_path,
        market_data_client=FakeMarketDataClient(error=RuntimeError("akshare failed")),
        scheduler_enabled=False,
        settings=Settings(candle_completion_delay_seconds=180),
    )
    client = TestClient(app)

    response = client.get("/api/monitor/snapshot?symbol=159915.SZ")

    assert response.status_code == 200
    body = response.json()
    assert body["data_status"] == "cached"
    assert body["latest_candle"]["time"] == "2026-08-07T10:45:00"
    assert [item["time"] for item in body["candles"]] == ["2026-08-07T10:45:00"]


def test_snapshot_hides_previous_day_candles_before_first_candle(monkeypatch, tmp_path):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 7, 22, 8, 30, tzinfo=tz)

    monkeypatch.setattr(service_module, "datetime", FrozenDateTime)
    app = create_app(
        db_path=tmp_path / "alerts.db",
        market_data_client=FakeMarketDataClient(
            candles=[
                candle("2026-07-21T14:45:00", 900),
                candle("2026-07-21T15:00:00", 950),
            ]
        ),
        scheduler_enabled=False,
    )
    client = TestClient(app)

    response = client.get("/api/monitor/snapshot?symbol=159915.SZ")

    assert response.status_code == 200
    body = response.json()
    assert body["data_status"] == "empty"
    assert body["latest_candle"] is None
    assert body["candles"] == []
    assert body["last_updated"] is None
