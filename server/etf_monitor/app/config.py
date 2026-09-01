from __future__ import annotations

import os
from datetime import time
from pathlib import Path

from pydantic import BaseModel, Field


DEFAULT_SYMBOLS = (
    "588000.SH:科创50ETF华夏,"
    "159915.SZ:创业板ETF易方达,"
    "510300.SH:沪深300ETF华泰柏瑞,"
    "513310.SH:中韩半导体ETF华泰柏瑞"
)
_DEFAULT_LATE_SESSION_START = time(14, 30)
DEFAULT_SYMBOL_FIRST_CANDLE_TIMES = "513310.SH:10:45"
_ENV_LOADED = False


def _ensure_env_loaded() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    for path in _env_file_candidates():
        if path.is_file():
            _load_env_file(path)
    _ENV_LOADED = True


def _env_file_candidates() -> list[Path]:
    project_root = Path(__file__).resolve().parents[2]
    candidates = [Path.cwd() / ".env", Path.cwd().parent / ".env", project_root / ".env"]
    unique: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(resolved)
    return unique


def _load_env_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


def _float_env(name: str, default: float) -> float:
    _ensure_env_loaded()
    value = os.getenv(name)
    return default if value is None or value == "" else float(value)


def _int_env(name: str, default: int) -> int:
    _ensure_env_loaded()
    value = os.getenv(name)
    return default if value is None or value == "" else int(value)


def _str_env(name: str, default: str) -> str:
    _ensure_env_loaded()
    value = os.getenv(name)
    return default if value is None or value == "" else value


def _time_env(name: str, default: time) -> time:
    _ensure_env_loaded()
    value = os.getenv(name)
    if value is None or value == "":
        return default
    parts = value.split(":")
    if len(parts) != 2:
        return default
    try:
        return time(int(parts[0]), int(parts[1]))
    except ValueError:
        return default


def _time_value(value: str, default: time) -> time:
    parts = value.split(":")
    if len(parts) != 2:
        return default
    try:
        return time(int(parts[0]), int(parts[1]))
    except ValueError:
        return default


def _bool_env(name: str, default: bool) -> bool:
    _ensure_env_loaded()
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.lower() in {"1", "true", "yes", "on"}


class EtfSymbolConfig(BaseModel):
    symbol: str
    name: str


def _symbols_env() -> list[EtfSymbolConfig]:
    raw_symbols = _str_env("ETF_SYMBOLS", DEFAULT_SYMBOLS)
    symbols: list[EtfSymbolConfig] = []
    seen: set[str] = set()
    for raw_item in raw_symbols.split(","):
        item = raw_item.strip()
        if not item:
            continue
        if ":" in item:
            raw_symbol, raw_name = item.split(":", 1)
        else:
            raw_symbol, raw_name = item, item
        symbol = raw_symbol.strip().upper()
        name = raw_name.strip() or symbol
        if symbol and symbol not in seen:
            symbols.append(EtfSymbolConfig(symbol=symbol, name=name))
            seen.add(symbol)
    return symbols


def _symbol_first_candle_times_env() -> dict[str, time]:
    raw_value = _str_env(
        "SYMBOL_FIRST_CANDLE_TIMES", DEFAULT_SYMBOL_FIRST_CANDLE_TIMES
    )
    values: dict[str, time] = {}
    for raw_item in raw_value.split(","):
        item = raw_item.strip()
        if not item or ":" not in item:
            continue
        raw_symbol, raw_time = item.split(":", 1)
        symbol = raw_symbol.strip().upper()
        if symbol:
            values[symbol] = _time_value(raw_time.strip(), time(9, 45))
    return values


class Settings(BaseModel):
    symbol: str = Field(default_factory=lambda: _str_env("ETF_SYMBOL", "159915.SZ"))
    symbol_name: str = Field(default_factory=lambda: _str_env("ETF_NAME", "创业板ETF易方达"))
    symbols: list[EtfSymbolConfig] = Field(default_factory=_symbols_env)
    kline_period: str = Field(default_factory=lambda: _str_env("KLINE_PERIOD", "15"))
    late_session_kline_period: str = Field(
        default_factory=lambda: _str_env("LATE_SESSION_KLINE_PERIOD", "5")
    )
    late_session_start_time: time = Field(
        default_factory=lambda: _time_env(
            "LATE_SESSION_START_TIME", _DEFAULT_LATE_SESSION_START
        )
    )
    symbol_first_candle_times: dict[str, time] = Field(
        default_factory=_symbol_first_candle_times_env
    )
    opening_volume_ratio_threshold: float = Field(
        default_factory=lambda: _float_env(
            "OPENING_VOLUME_RATIO_THRESHOLD", 1.15
        )
    )
    opening_critical_ratio_threshold: float = Field(
        default_factory=lambda: _float_env(
            "OPENING_CRITICAL_RATIO_THRESHOLD", 3.0
        )
    )
    timezone: str = Field(default_factory=lambda: _str_env("APP_TIMEZONE", "Asia/Shanghai"))
    trading_calendar_path: Path = Field(
        default_factory=lambda: Path(
            _str_env(
                "TRADING_CALENDAR_PATH",
                "server/data/etf-monitor/trading_calendar.json",
            )
        )
    )
    morning_open_time: time = Field(
        default_factory=lambda: _time_env("MORNING_OPEN_TIME", time(9, 30))
    )
    morning_close_time: time = Field(
        default_factory=lambda: _time_env("MORNING_CLOSE_TIME", time(11, 30))
    )
    afternoon_open_time: time = Field(
        default_factory=lambda: _time_env("AFTERNOON_OPEN_TIME", time(13, 0))
    )
    afternoon_close_time: time = Field(
        default_factory=lambda: _time_env("AFTERNOON_CLOSE_TIME", time(15, 0))
    )
    db_path: Path = Field(
        default_factory=lambda: Path(
            _str_env("DB_PATH", "server/data/etf-monitor/etf_monitor.db")
        )
    )
    poll_interval_seconds: int = Field(
        default_factory=lambda: _int_env("POLL_INTERVAL_SECONDS", 60)
    )
    candle_completion_delay_seconds: int = Field(
        default_factory=lambda: _int_env("CANDLE_COMPLETION_DELAY_SECONDS", 60)
    )
    no_anomaly_confirmation_delay_seconds: int = Field(
        default_factory=lambda: _int_env("NO_ANOMALY_CONFIRMATION_DELAY_SECONDS", 90)
    )
    batch_notification_max_lag_seconds: int = Field(
        default_factory=lambda: _int_env("BATCH_NOTIFICATION_MAX_LAG_SECONDS", 900)
    )
    volume_ratio_threshold: float = Field(
        default_factory=lambda: _float_env("VOLUME_RATIO_THRESHOLD", 1.3)
    )
    late_session_volume_ratio_threshold: float = Field(
        default_factory=lambda: _float_env(
            "LATE_SESSION_VOLUME_RATIO_THRESHOLD", 1.3
        )
    )
    volume_shrink_ratio_threshold: float = Field(
        default_factory=lambda: _float_env("VOLUME_SHRINK_RATIO_THRESHOLD", 0.5)
    )
    critical_ratio_threshold: float = Field(
        default_factory=lambda: _float_env("CRITICAL_RATIO_THRESHOLD", 5.0)
    )
    late_session_critical_ratio_threshold: float = Field(
        default_factory=lambda: _float_env(
            "LATE_SESSION_CRITICAL_RATIO_THRESHOLD", 4.5
        )
    )
    rolling_window_min: int = Field(
        default_factory=lambda: _int_env("ROLLING_WINDOW_MIN", 8)
    )
    rolling_window_max: int = Field(
        default_factory=lambda: _int_env("ROLLING_WINDOW_MAX", 20)
    )
    scheduler_enabled: bool = Field(
        default_factory=lambda: _bool_env("SCHEDULER_ENABLED", True)
    )
    cors_origin: str = Field(
        default_factory=lambda: _str_env("CORS_ORIGIN", "http://localhost:5174")
    )
    email_enabled: bool = Field(
        default_factory=lambda: _bool_env("EMAIL_ENABLED", False)
    )
    smtp_host: str = Field(default_factory=lambda: _str_env("SMTP_HOST", ""))
    smtp_port: int = Field(default_factory=lambda: _int_env("SMTP_PORT", 465))
    smtp_username: str = Field(default_factory=lambda: _str_env("SMTP_USERNAME", ""))
    smtp_password: str = Field(default_factory=lambda: _str_env("SMTP_PASSWORD", ""))
    smtp_from: str = Field(default_factory=lambda: _str_env("SMTP_FROM", ""))
    smtp_to: str = Field(default_factory=lambda: _str_env("SMTP_TO", ""))
    smtp_use_ssl: bool = Field(
        default_factory=lambda: _bool_env("SMTP_USE_SSL", True)
    )
    smtp_starttls: bool = Field(
        default_factory=lambda: _bool_env("SMTP_STARTTLS", False)
    )
    smtp_timeout_seconds: int = Field(
        default_factory=lambda: _int_env("SMTP_TIMEOUT_SECONDS", 10)
    )

    def monitored_symbols(self) -> list[EtfSymbolConfig]:
        if self.symbols:
            return self.symbols
        return [EtfSymbolConfig(symbol=self.symbol.upper(), name=self.symbol_name)]

    def name_for_symbol(self, symbol: str) -> str:
        normalized = symbol.upper()
        for item in self.monitored_symbols():
            if item.symbol.upper() == normalized:
                return item.name
        if normalized == self.symbol.upper():
            return self.symbol_name
        return symbol

    def is_late_session(self, candle_time) -> bool:
        """A candle counts as late-session only after the configured start."""
        if hasattr(candle_time, "time"):
            candle_time = candle_time.time()
        return candle_time > self.late_session_start_time

    def kline_period_for(self, candle_time) -> str:
        if self.is_late_session(candle_time):
            return self.late_session_kline_period
        return self.kline_period

    def volume_ratio_threshold_for(self, candle_time) -> float:
        if self.is_morning_opening_candle(candle_time):
            return self.opening_volume_ratio_threshold
        if self.is_late_session(candle_time):
            return self.late_session_volume_ratio_threshold
        return self.volume_ratio_threshold

    def critical_ratio_threshold_for(self, candle_time) -> float:
        if self.is_opening_candle(candle_time):
            return self.opening_critical_ratio_threshold
        if self.is_late_session(candle_time):
            return self.late_session_critical_ratio_threshold
        return self.critical_ratio_threshold

    def is_opening_candle(self, candle_time) -> bool:
        """Same-slot candles (9:45, 13:15) compare to the previous trading day."""
        if hasattr(candle_time, "time"):
            candle_time = candle_time.time()
        return candle_time in {time(9, 45), time(13, 15)}

    def is_morning_opening_candle(self, candle_time) -> bool:
        if hasattr(candle_time, "time"):
            candle_time = candle_time.time()
        return candle_time == time(9, 45)

    def first_completed_candle_time_for(self, symbol: str) -> time:
        return self.symbol_first_candle_times.get(symbol.upper(), time(9, 45))

    def should_wait_for_symbol_at(self, symbol: str, candle_time) -> bool:
        if hasattr(candle_time, "time"):
            candle_time = candle_time.time()
        return candle_time >= self.first_completed_candle_time_for(symbol)
