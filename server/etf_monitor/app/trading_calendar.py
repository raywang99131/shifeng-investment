from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Callable, Literal, Protocol
from zoneinfo import ZoneInfo

from app.config import Settings


CalendarQuality = Literal["confirmed", "cached", "weekday_fallback"]
MarketPhase = Literal[
    "pre_open",
    "morning_session",
    "lunch_break",
    "afternoon_session",
    "post_close",
    "closed_day",
]


@dataclass(frozen=True)
class TradingDayResolution:
    is_trading_day: bool
    quality: CalendarQuality
    error: str | None = None


@dataclass(frozen=True)
class SessionDecision:
    phase: MarketPhase
    should_poll: bool
    calendar_quality: CalendarQuality
    calendar_error: str | None = None


class TradingDayProvider(Protocol):
    def fetch_trading_days(self) -> set[date]: ...


class AkShareTradingDayProvider:
    def fetch_trading_days(self) -> set[date]:
        import akshare as ak

        frame = ak.tool_trade_date_hist_sina()
        trading_days: set[date] = set()
        for value in frame["trade_date"].tolist():
            if isinstance(value, datetime):
                trading_days.add(value.date())
            elif isinstance(value, date):
                trading_days.add(value)
            else:
                trading_days.add(date.fromisoformat(str(value)[:10]))
        if not trading_days:
            raise RuntimeError("trading calendar provider returned no dates")
        return trading_days


class TradingDayCalendar:
    def __init__(
        self,
        cache_path: Path,
        provider: TradingDayProvider | None = None,
        now: Callable[[], datetime] | None = None,
    ):
        self.cache_path = Path(cache_path)
        self.provider = provider
        self.now = now or (lambda: datetime.now(UTC))
        self._loaded = False
        self._trading_days: set[date] = set()
        self._covered_years: set[int] = set()
        self._updated_at: datetime | None = None
        self._last_attempt_date: date | None = None
        self._last_error: str | None = None

    def resolve(
        self, target_date: date, *, force_refresh: bool = False
    ) -> TradingDayResolution:
        self._load_cache()
        today = self.now().date()
        is_covered = target_date.year in self._covered_years
        cache_is_fresh = self._updated_at is not None and self._updated_at.date() == today
        should_refresh = force_refresh or (
            (not is_covered or not cache_is_fresh)
            and self._last_attempt_date != today
        )

        if should_refresh:
            self._last_attempt_date = today
            try:
                self._refresh()
            except Exception as exc:
                self._last_error = str(exc)
            else:
                return TradingDayResolution(
                    target_date in self._trading_days,
                    "confirmed",
                )

        if target_date.year in self._covered_years:
            return TradingDayResolution(
                target_date in self._trading_days,
                "cached",
                self._last_error,
            )

        return TradingDayResolution(
            target_date.weekday() < 5,
            "weekday_fallback",
            self._last_error or "trading calendar data is unavailable",
        )

    def _refresh(self) -> None:
        if self.provider is None:
            raise RuntimeError("trading calendar provider is unavailable")
        trading_days = self.provider.fetch_trading_days()
        if not trading_days:
            raise RuntimeError("trading calendar provider returned no dates")
        updated_at = self.now()
        self._trading_days = set(trading_days)
        self._covered_years = {item.year for item in trading_days}
        self._updated_at = updated_at
        self._last_error = None
        self._write_cache(updated_at)

    def _load_cache(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self.cache_path.is_file():
            return
        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
            self._trading_days = {
                date.fromisoformat(value) for value in payload["trading_days"]
            }
            self._covered_years = {
                int(value) for value in payload.get("covered_years", [])
            } or {item.year for item in self._trading_days}
            self._updated_at = datetime.fromisoformat(payload["updated_at"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError, OSError) as exc:
            self._trading_days = set()
            self._covered_years = set()
            self._updated_at = None
            self._last_error = f"invalid trading calendar cache: {exc}"

    def _write_cache(self, updated_at: datetime) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.cache_path.with_suffix(self.cache_path.suffix + ".tmp")
        payload = {
            "updated_at": updated_at.isoformat(),
            "covered_years": sorted(self._covered_years),
            "trading_days": sorted(item.isoformat() for item in self._trading_days),
        }
        temporary_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary_path.replace(self.cache_path)


def market_session_at(
    now: datetime,
    trading_day: TradingDayResolution,
    settings: Settings,
) -> SessionDecision:
    if not trading_day.is_trading_day:
        return SessionDecision(
            "closed_day",
            False,
            trading_day.quality,
            trading_day.error,
        )

    if now.tzinfo is not None:
        local_time = now.astimezone(ZoneInfo(settings.timezone)).time().replace(tzinfo=None)
    else:
        local_time = now.time()

    if local_time < settings.morning_open_time:
        phase: MarketPhase = "pre_open"
    elif local_time < settings.morning_close_time:
        phase = "morning_session"
    elif local_time < settings.afternoon_open_time:
        phase = "lunch_break"
    elif local_time < settings.afternoon_close_time:
        phase = "afternoon_session"
    else:
        phase = "post_close"

    return SessionDecision(
        phase,
        phase in {"morning_session", "afternoon_session"},
        trading_day.quality,
        trading_day.error,
    )
