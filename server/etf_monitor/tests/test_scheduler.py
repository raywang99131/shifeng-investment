from __future__ import annotations

import threading
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
    def __init__(self, settings: Settings):
        self.settings = settings
        self.poll_count = 0
        self.polled = threading.Event()

    def poll_all(self):
        self.poll_count += 1
        self.polled.set()
        return [SimpleNamespace(error=None)]


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
