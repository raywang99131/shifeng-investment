from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.config import Settings
from app.trading_calendar import (
    TradingDayCalendar,
    TradingDayResolution,
    market_session_at,
)


SHANGHAI = ZoneInfo("Asia/Shanghai")


class StaticProvider:
    def __init__(self, trading_days: set[date]):
        self.trading_days = trading_days
        self.calls = 0

    def fetch_trading_days(self) -> set[date]:
        self.calls += 1
        return self.trading_days


class FailingProvider:
    def fetch_trading_days(self) -> set[date]:
        raise RuntimeError("calendar unavailable")


def local_datetime(hour: int, minute: int) -> datetime:
    return datetime(2026, 8, 12, hour, minute, tzinfo=SHANGHAI)


@pytest.mark.parametrize(
    ("hour", "minute", "phase", "should_poll"),
    [
        (9, 29, "pre_open", False),
        (9, 30, "morning_session", True),
        (11, 29, "morning_session", True),
        (11, 30, "lunch_break", False),
        (12, 59, "lunch_break", False),
        (13, 0, "afternoon_session", True),
        (14, 59, "afternoon_session", True),
        (15, 0, "post_close", False),
    ],
)
def test_market_session_boundaries(hour, minute, phase, should_poll):
    decision = market_session_at(
        local_datetime(hour, minute),
        TradingDayResolution(is_trading_day=True, quality="confirmed"),
        Settings(scheduler_enabled=False),
    )

    assert decision.phase == phase
    assert decision.should_poll is should_poll
    assert decision.calendar_quality == "confirmed"


def test_non_trading_day_is_always_closed():
    decision = market_session_at(
        local_datetime(10, 0),
        TradingDayResolution(is_trading_day=False, quality="confirmed"),
        Settings(scheduler_enabled=False),
    )

    assert decision.phase == "closed_day"
    assert decision.should_poll is False


def test_calendar_refresh_persists_confirmed_trading_days(tmp_path):
    provider = StaticProvider({date(2026, 8, 12), date(2026, 8, 13)})
    cache_path = tmp_path / "trading_calendar.json"
    calendar = TradingDayCalendar(
        cache_path,
        provider=provider,
        now=lambda: datetime(2026, 8, 12, tzinfo=UTC),
    )

    resolution = calendar.resolve(date(2026, 8, 12))

    assert resolution == TradingDayResolution(True, "confirmed")
    assert provider.calls == 1
    assert cache_path.is_file()

    cached = TradingDayCalendar(
        cache_path,
        provider=FailingProvider(),
        now=lambda: datetime(2026, 8, 12, 1, tzinfo=UTC),
    ).resolve(date(2026, 8, 13))
    assert cached == TradingDayResolution(True, "cached")


def test_calendar_identifies_weekday_holiday_from_confirmed_data(tmp_path):
    provider = StaticProvider({date(2026, 10, 9)})
    calendar = TradingDayCalendar(
        tmp_path / "trading_calendar.json",
        provider=provider,
        now=lambda: datetime(2026, 10, 1, tzinfo=UTC),
    )

    resolution = calendar.resolve(date(2026, 10, 1))

    assert resolution == TradingDayResolution(False, "confirmed")


def test_calendar_uses_weekday_fallback_when_refresh_and_cache_fail(tmp_path):
    calendar = TradingDayCalendar(
        tmp_path / "missing.json",
        provider=FailingProvider(),
        now=lambda: datetime(2026, 8, 12, tzinfo=UTC),
    )

    weekday = calendar.resolve(date(2026, 8, 12))
    weekend = calendar.resolve(date(2026, 8, 15))

    assert weekday.is_trading_day is True
    assert weekday.quality == "weekday_fallback"
    assert "calendar unavailable" in (weekday.error or "")
    assert weekend.is_trading_day is False
    assert weekend.quality == "weekday_fallback"
