from __future__ import annotations

import logging
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

logger = logging.getLogger(__name__)


class PollScheduler:
    def __init__(
        self,
        service: MonitorService,
        interval_seconds: int,
        *,
        trading_calendar: TradingDayCalendar | None = None,
        now: Callable[[], datetime] | None = None,
        enabled: bool | None = None,
        on_stall: Callable[[str], None] | None = None,
    ):
        self.service = service
        self.settings = service.settings
        self.interval_seconds = interval_seconds
        self.enabled = self.settings.scheduler_enabled if enabled is None else enabled
        self.on_stall = on_stall
        self.trading_calendar = trading_calendar or TradingDayCalendar(
            self.settings.trading_calendar_path,
            provider=AkShareTradingDayProvider(),
        )
        timezone = ZoneInfo(self.settings.timezone)
        self.now = now or (lambda: datetime.now(timezone))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._watchdog_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._running = False
        self._phase = "initializing"
        self._should_poll = False
        self._calendar_quality = None
        self._calendar_error: str | None = None
        self._last_cycle_at: datetime | None = None
        self._last_poll_attempt: datetime | None = None
        self._last_poll_success: datetime | None = None
        self._last_poll_at: datetime | None = None
        self._next_check_at: datetime | None = None
        self._finalized_for_date: date | None = None
        self._error: str | None = None
        self._cycle_in_progress = False

    def start(self) -> None:
        if not self.enabled:
            return
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        with self._lock:
            self._running = True
            self._next_check_at = self._local_now()
        self._thread = threading.Thread(
            target=self._run,
            name="etf-volume-monitor",
            daemon=True,
        )
        self._thread.start()
        if self.on_stall is not None:
            self._watchdog_thread = threading.Thread(
                target=self._watchdog, name="etf-monitor-watchdog", daemon=True
            )
            self._watchdog_thread.start()

    def stop(self) -> None:
        self._stop.set()
        for worker in (self._thread, self._watchdog_thread):
            if worker is not None and worker is not threading.current_thread():
                worker.join(timeout=2)
        with self._lock:
            self._running = False

    def _local_now(self) -> datetime:
        observed_at = self.now()
        if observed_at.tzinfo is None:
            return observed_at.replace(tzinfo=ZoneInfo(self.settings.timezone))
        return observed_at.astimezone(ZoneInfo(self.settings.timezone))

    def run_once(self) -> None:
        local_now = self._local_now()
        # Include calendar network requests in the watchdog's deadline.
        with self._lock:
            self._last_cycle_at = local_now
            self._cycle_in_progress = True
        try:
            self.service.retry_notifications()
            self._run_cycle(local_now)
        except Exception as exc:
            with self._lock:
                self._error = str(exc)
            raise
        finally:
            with self._lock:
                self._cycle_in_progress = False
                self._next_check_at = self._local_now() + timedelta(
                    seconds=self._wait_seconds_for(self._should_poll)
                )

    def _run_cycle(self, local_now: datetime) -> None:
        resolution = self.trading_calendar.resolve(local_now.date())
        decision = market_session_at(local_now, resolution, self.settings)
        is_final_poll = self._needs_final_poll(local_now, decision.phase)
        should_execute = decision.should_poll or is_final_poll
        wait_seconds = self._wait_seconds_for(decision.should_poll)
        poll_succeeded = False
        closing_candles_complete = False
        poll_error: str | None = None

        with self._lock:
            self._phase = decision.phase
            self._should_poll = decision.should_poll
            self._calendar_quality = decision.calendar_quality
            self._calendar_error = decision.calendar_error
            self._next_check_at = local_now + timedelta(seconds=wait_seconds)
            if should_execute:
                self._last_poll_attempt = local_now

        if should_execute:
            try:
                results = self.service.poll_all()
            except Exception as exc:
                poll_error = str(exc)
            else:
                poll_succeeded = bool(results) and all(
                    getattr(result, "error", None) is None for result in results
                )
                if is_final_poll and poll_succeeded:
                    close_at = datetime.combine(
                        local_now.date(), self.settings.afternoon_close_time,
                        tzinfo=local_now.tzinfo,
                    )
                    completed_symbols = set()
                    for result in results:
                        candle_time = result.latest_candle_time
                        if candle_time is None:
                            continue
                        if candle_time.tzinfo is None:
                            candle_time = candle_time.replace(tzinfo=local_now.tzinfo)
                        if candle_time == close_at:
                            completed_symbols.add(result.symbol)
                    closing_candles_complete = all(
                        item.symbol in completed_symbols for item in self.settings.monitored_symbols()
                    )

        with self._lock:
            if should_execute:
                self._error = poll_error
            if poll_succeeded:
                self._last_poll_success = local_now
                self._last_poll_at = local_now
            if is_final_poll and poll_succeeded and closing_candles_complete:
                self._finalized_for_date = local_now.date()

    def status(self) -> SchedulerHealth:
        local_now = self._local_now()
        with self._lock:
            # An in-flight cycle has a fixed deadline; an idle scheduler gets
            # that grace period after its next scheduled check, even with a
            # deliberately long polling interval or outside trading hours.
            reference = (
                self._last_cycle_at if self._cycle_in_progress else self._next_check_at
            )
            stalled = bool(
                self.enabled and not self._stop.is_set() and reference is not None
                and (local_now - reference).total_seconds()
                > self.settings.poll_stall_timeout_seconds
            )
            error = "自动监控长时间未完成检查，正在自动恢复" if stalled else self._error
            return SchedulerHealth(
                enabled=self.enabled,
                running=self._running,
                stalled=stalled,
                phase=self._phase,
                should_poll=self._should_poll,
                monitoring_active=(
                    self.enabled and self._should_poll and not stalled
                    and not self._stop.is_set() and not error
                ),
                calendar_quality=self._calendar_quality,
                calendar_error=self._calendar_error,
                last_cycle_at=self._last_cycle_at,
                last_poll_attempt=self._last_poll_attempt,
                last_poll_success=self._last_poll_success,
                last_poll_at=self._last_poll_at,
                next_check_at=self._next_check_at,
                finalized_for_date=self._finalized_for_date,
                error=error,
            )

    def _watchdog(self) -> None:
        check_seconds = min(5.0, self.settings.poll_stall_timeout_seconds / 3)
        while not self._stop.wait(check_seconds):
            status = self.status()
            if status.stalled:
                self.on_stall(status.error)
                return

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

    def _wait_seconds_for(self, should_poll: bool) -> int:
        active_wait = max(1, self.interval_seconds)
        return active_wait if should_poll else min(active_wait, 60)

    def _run(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    self.run_once()
                except Exception:
                    logger.exception("ETF scheduler cycle failed")
                with self._lock:
                    should_poll = self._should_poll
                if self._stop.wait(self._wait_seconds_for(should_poll)):
                    break
        finally:
            with self._lock:
                self._running = False
