from __future__ import annotations

import threading
import pytest
from datetime import date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.config import Settings
from app.scheduler import PollScheduler
from app.trading_calendar import TradingDayResolution


SHANGHAI = ZoneInfo("Asia/Shanghai")


class MutableClock:
    def __init__(self, value: datetime):
        self.value = value

    def __call__(self) -> datetime:
        return self.value


class StaticCalendar:
    def __init__(self, is_trading_day: bool = True):
        self.is_trading_day = is_trading_day
        self.requested_dates: list[date] = []

    def resolve(self, target_date: date) -> TradingDayResolution:
        self.requested_dates.append(target_date)
        return TradingDayResolution(self.is_trading_day, "confirmed")


class RecordingService:
    def retry_notifications(self):
        pass

    def __init__(self, settings: Settings):
        self.settings = settings
        self.poll_count = 0
        self.polled = threading.Event()

    def poll_all(self):
        self.poll_count += 1
        self.polled.set()
        return [SimpleNamespace(error=None, symbol=item.symbol, latest_candle_time=at(15, 0))
                for item in self.settings.monitored_symbols()]


def at(hour: int, minute: int, second: int = 0) -> datetime:
    return datetime(2026, 8, 12, hour, minute, second, tzinfo=SHANGHAI)


def test_scheduler_polls_only_during_sessions_and_once_after_close():
    settings = Settings(
        scheduler_enabled=True,
        candle_completion_delay_seconds=60,
    )
    service = RecordingService(settings)
    clock = MutableClock(at(10, 0))
    scheduler = PollScheduler(
        service,
        interval_seconds=60,
        trading_calendar=StaticCalendar(),
        now=clock,
    )

    scheduler.run_once()
    assert service.poll_count == 1
    assert scheduler.status().phase == "morning_session"
    assert scheduler.status().monitoring_active is True
    assert scheduler.status().last_poll_attempt == at(10, 0)
    assert scheduler.status().last_poll_success == at(10, 0)

    clock.value = at(11, 30)
    scheduler.run_once()
    assert service.poll_count == 1
    assert scheduler.status().phase == "lunch_break"

    clock.value = at(13, 0)
    scheduler.run_once()
    assert service.poll_count == 2
    assert scheduler.status().phase == "afternoon_session"

    clock.value = at(15, 0, 59)
    scheduler.run_once()
    assert service.poll_count == 2

    clock.value = at(15, 1)
    scheduler.run_once()
    assert service.poll_count == 3
    assert scheduler.status().finalized_for_date == date(2026, 8, 12)

    clock.value = at(15, 5)
    scheduler.run_once()
    assert service.poll_count == 3


def test_scheduler_never_polls_on_closed_day():
    settings = Settings(scheduler_enabled=True)
    service = RecordingService(settings)
    scheduler = PollScheduler(
        service,
        interval_seconds=60,
        trading_calendar=StaticCalendar(is_trading_day=False),
        now=lambda: at(10, 0),
    )

    scheduler.run_once()

    assert service.poll_count == 0
    assert scheduler.status().phase == "closed_day"
    assert scheduler.status().should_poll is False


def test_scheduler_caps_idle_checks_at_one_minute():
    settings = Settings(scheduler_enabled=True)
    service = RecordingService(settings)
    clock = MutableClock(at(11, 30))
    scheduler = PollScheduler(
        service,
        interval_seconds=300,
        trading_calendar=StaticCalendar(),
        now=clock,
    )

    scheduler.run_once()
    assert scheduler.status().next_check_at == at(11, 31)

    clock.value = at(13, 0)
    scheduler.run_once()
    assert scheduler.status().next_check_at == at(13, 5)


def test_scheduler_stop_interrupts_long_wait():
    settings = Settings(scheduler_enabled=True)
    service = RecordingService(settings)
    scheduler = PollScheduler(
        service,
        interval_seconds=3600,
        trading_calendar=StaticCalendar(),
        now=lambda: at(10, 0),
    )

    scheduler.start()
    assert service.polled.wait(timeout=1)
    scheduler.stop()

    assert scheduler.status().running is False
    assert scheduler.status().monitoring_active is False


def test_stalled_cycle_is_not_reported_as_active_monitoring():
    service = RecordingService(Settings(scheduler_enabled=True))
    clock = MutableClock(at(10, 23))
    scheduler = PollScheduler(service, 60, trading_calendar=StaticCalendar(), now=clock)
    scheduler.run_once()

    clock.value = at(14, 3)
    status = scheduler.status()

    assert status.monitoring_active is False
    assert status.stalled is True
    assert status.error


def test_watchdog_requests_recovery_when_poll_never_returns():
    service = RecordingService(Settings(scheduler_enabled=True, poll_stall_timeout_seconds=1))
    release = threading.Event()
    recovered = threading.Event()

    def blocked_poll():
        service.polled.set()
        release.wait(timeout=3)
        return [SimpleNamespace(error=None)]

    service.poll_all = blocked_poll
    clock = MutableClock(at(10, 23))
    scheduler = PollScheduler(
        service, 60, trading_calendar=StaticCalendar(), now=clock,
        on_stall=lambda error: recovered.set(),
    )
    try:
        scheduler.start()
        assert service.polled.wait(timeout=1)
        clock.value = at(10, 24)
        assert recovered.wait(timeout=2), 'a blocked request must trigger recovery'
    finally:
        release.set()
        scheduler.stop()


def test_watchdog_also_covers_blocked_calendar_requests():
    service = RecordingService(Settings(scheduler_enabled=True, poll_stall_timeout_seconds=1))
    entered = threading.Event()
    release = threading.Event()
    recovered = threading.Event()

    class BlockedCalendar:
        def resolve(self, target_date):
            entered.set()
            release.wait(timeout=3)
            return TradingDayResolution(True, 'confirmed')

    clock = MutableClock(at(10, 23))
    scheduler = PollScheduler(
        service, 60, trading_calendar=BlockedCalendar(), now=clock,
        on_stall=lambda error: recovered.set(),
    )
    try:
        scheduler.start()
        assert entered.wait(timeout=1)
        clock.value = at(10, 24)
        assert recovered.wait(timeout=2)
        assert scheduler.status().stalled is True
    finally:
        release.set()
        scheduler.stop()


def test_long_poll_interval_is_not_mistaken_for_stalled_work():
    service = RecordingService(Settings(scheduler_enabled=True, poll_stall_timeout_seconds=5))
    clock = MutableClock(at(10, 0))
    scheduler = PollScheduler(service, 3600, trading_calendar=StaticCalendar(), now=clock)
    scheduler.run_once()
    clock.value = at(10, 30)
    assert scheduler.status().stalled is False
    assert scheduler.status().monitoring_active is True


def test_pending_mail_retries_even_when_market_is_closed():
    service = RecordingService(Settings(scheduler_enabled=True))
    retried = []
    service.retry_notifications = lambda: retried.append(True)
    scheduler = PollScheduler(service, 60, trading_calendar=StaticCalendar(False), now=lambda: at(16, 0))
    scheduler.run_once()
    assert retried == [True]
    assert service.poll_count == 0


def test_failed_closing_poll_is_retried_until_all_symbols_succeed():
    service = RecordingService(Settings(scheduler_enabled=True))
    results = [SimpleNamespace(error=None, symbol=item.symbol, latest_candle_time=at(15, 0))
               for item in service.settings.monitored_symbols()]
    results[-1].error = 'source offline'
    service.poll_all = lambda: results
    clock = MutableClock(at(15, 1))
    scheduler = PollScheduler(service, 60, trading_calendar=StaticCalendar(), now=clock)
    scheduler.run_once()
    assert scheduler.status().finalized_for_date is None
    assert scheduler.status().last_poll_success is None
    results[-1].error = None
    clock.value = at(15, 2)
    scheduler.run_once()
    assert scheduler.status().finalized_for_date == date(2026, 8, 12)
    assert scheduler.status().last_poll_success == at(15, 2)


@pytest.mark.parametrize('delayed_time', [None, '2026-08-12T14:55:00', '2026-08-11T15:00:00'])
def test_closing_poll_waits_for_current_day_final_candle_for_every_symbol(tmp_path, monkeypatch, delayed_time):
    from app import service as service_module
    from app.config import EtfSymbolConfig
    from app.service import MonitorService
    from test_api import RecordingNotifier, SymbolAwareMarketDataClient, candle

    clock = MutableClock(at(15, 1))
    class ServiceClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock.value.astimezone(tz) if tz else clock.value.replace(tzinfo=None)
    monkeypatch.setattr(service_module, 'datetime', ServiceClock)
    symbols = [EtfSymbolConfig(symbol='159915.SZ', name='ETF A'),
               EtfSymbolConfig(symbol='510300.SH', name='ETF B')]
    data = {'159915.SZ': [candle('2026-08-12T15:00:00', 1000)],
            '510300.SH': [candle(delayed_time, 1000, symbol='510300.SH')] if delayed_time else []}
    client = SymbolAwareMarketDataClient(data)
    notifier = RecordingNotifier()
    service = MonitorService(Settings(symbols=symbols, scheduler_enabled=True), client,
                             tmp_path / 'monitor.db', notifier)
    scheduler = PollScheduler(service, 60, trading_calendar=StaticCalendar(), now=clock)
    scheduler.run_once()
    assert scheduler.status().finalized_for_date is None
    assert notifier.daily_summaries == []
    data['510300.SH'] = [candle('2026-08-12T15:00:00', 1000, symbol='510300.SH')]
    clock.value = at(15, 2)
    scheduler.run_once()
    assert scheduler.status().finalized_for_date == date(2026, 8, 12)
    assert len(notifier.daily_summaries) == 1
    clock.value = at(15, 3)
    scheduler.run_once()
    assert len(notifier.daily_summaries) == 1
