import os
import subprocess
import sys
from pathlib import Path


def test_production_watchdog_exits_a_process_with_a_stuck_worker(tmp_path):
    result = subprocess.run(
        [sys.executable, '-c', '''
import threading
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from app.config import Settings
from app.main import restart_stalled_process
from app.scheduler import PollScheduler
from app.trading_calendar import TradingDayResolution

started = time.monotonic()
base = datetime(2026, 8, 12, 10, 0, tzinfo=ZoneInfo('Asia/Shanghai'))
service = SimpleNamespace(
    settings=Settings(scheduler_enabled=True, poll_stall_timeout_seconds=0.15),
    poll_all=lambda: threading.Event().wait(30),
    retry_notifications=lambda: None,
)
scheduler = PollScheduler(
    service, 60,
    trading_calendar=SimpleNamespace(resolve=lambda day: TradingDayResolution(True, 'confirmed')),
    now=lambda: base + timedelta(seconds=time.monotonic() - started),
    on_stall=restart_stalled_process,
)
scheduler.start()
threading.Event().wait(5)
raise SystemExit(3)
'''],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, 'EMAIL_ENABLED': 'false', 'DB_PATH': str(tmp_path / 'watchdog.db')},
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 1, result.stderr
    assert 'exiting for supervisor restart' in result.stderr
