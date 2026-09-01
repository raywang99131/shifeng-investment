from __future__ import annotations

import threading
from datetime import date, datetime, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

from app.models import SchedulerHealth
from app.service import MonitorService
from app.trading_calendar import (
    AkShareTradingDayProvider,
    TradingDayCalendar,
    market_session_at,
)


class PollScheduler:
    def __init__(
        self,
        service: MonitorService,
        interval_seconds: int,
        *,
        trading_calendar: TradingDayCalendar | None = None,
        now: Callable[[], datetime] | None = None,
        enabled: bool | None = None,
    ):
        self.service = service
        self.settings = service.settings
        self.interval_seconds = interval_seconds
        self.enabled = self.settings.scheduler_enabled if enabled is None else enabled
        self.trading_calendar = trading_calendar or TradingDayCalendar(
            self.settings.trading_calendar_path,
            provider=AkShareTradingDayProvider(),
        )
        timezone = ZoneInfo(self.settings.timezone)
        self.now = now or (lambda: datetime.now(timezone))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._running = False
        self._phase = "initializing"
        self._should_poll = False
        self._calendar_quality = None
        self._calendar_error: str | None = None
        self._last_cycle_at: datetime | None = None
        self._last_poll_at: datetime | None = None
        self._next_check_at: datetime | None = None
        self._finalized_for_date: date | None = None
        self._error: str | None = None

    def start(self) -> None:
        if not self.enabled:
            return
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        with self._lock:
            self._running = True
        self._thread = threading.Thread(
            target=self._run,
            name="etf-volume-monitor",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        with self._lock:
            self._running = False

    def run_once(self) -> None:
        observed_at = self.now()
        if observed_at.tzinfo is None:
            local_now = observed_at.replace(tzinfo=ZoneInfo(self.settings.timezone))
        else:
            local_now = observed_at.astimezone(ZoneInfo(self.settings.timezone))
        resolution = self.trading_calendar.resolve(local_now.date())
        decision = market_session_at(local_now, resolution, self.settings)
        is_final_poll = self._needs_final_poll(local_now, decision.phase)
        poll_succeeded = False
        poll_error: str | None = None

        if decision.should_poll or is_final_poll:
            try:
                self.service.poll_all()
            except Exception as exc:
                poll_error = str(exc)
            else:
                poll_succeeded = True

        with self._lock:
            self._phase = decision.phase
            self._should_poll = decision.should_poll
            self._calendar_quality = decision.calendar_quality
            self._calendar_error = decision.calendar_error
            self._last_cycle_at = local_now
            self._next_check_at = local_now + timedelta(seconds=self.interval_seconds)
            if decision.should_poll or is_final_poll:
                self._error = poll_error
            if poll_succeeded:
                self._last_poll_at = local_now
                if is_final_poll:
                    self._finalized_for_date = local_now.date()

    def status(self) -> SchedulerHealth:
        with self._lock:
            return SchedulerHealth(
                enabled=self.enabled,
                running=self._running,
                phase=self._phase,
                should_poll=self._should_poll,
                calendar_quality=self._calendar_quality,
                calendar_error=self._calendar_error,
                last_cycle_at=self._last_cycle_at,
                last_poll_at=self._last_poll_at,
                next_check_at=self._next_check_at,
                finalized_for_date=self._finalized_for_date,
                error=self._error,
            )

    def _needs_final_poll(self, local_now: datetime, phase: str) -> bool:
        if phase != "post_close" or self._finalized_for_date == local_now.date():
            return False
        close_at = datetime.combine(
            local_now.date(),
            self.settings.afternoon_close_time,
            tzinfo=local_now.tzinfo,
        )
        finalization_at = close_at + timedelta(
            seconds=self.settings.candle_completion_delay_seconds
        )
        return local_now >= finalization_at

    def _run(self) -> None:
        try:
            while not self._stop.is_set():
                self.run_once()
                if self._stop.wait(self.interval_seconds):
                    break
        finally:
            with self._lock:
                self._running = False
