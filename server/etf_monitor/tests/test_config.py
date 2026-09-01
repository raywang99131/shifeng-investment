from datetime import time

from app import config
from app.config import Settings


def test_default_volume_ratio_thresholds_match_intraday_rules(monkeypatch):
    monkeypatch.setattr(config, "_ENV_LOADED", False)
    monkeypatch.setattr(config, "_env_file_candidates", lambda: [])
    monkeypatch.delenv("VOLUME_RATIO_THRESHOLD", raising=False)
    monkeypatch.delenv("OPENING_VOLUME_RATIO_THRESHOLD", raising=False)
    monkeypatch.delenv("LATE_SESSION_VOLUME_RATIO_THRESHOLD", raising=False)
    monkeypatch.delenv("CANDLE_COMPLETION_DELAY_SECONDS", raising=False)
    monkeypatch.delenv("NO_ANOMALY_CONFIRMATION_DELAY_SECONDS", raising=False)

    settings = Settings()

    assert settings.opening_volume_ratio_threshold == 1.15
    assert settings.volume_ratio_threshold == 1.3
    assert settings.late_session_volume_ratio_threshold == 1.3
    assert settings.candle_completion_delay_seconds == 60
    assert settings.no_anomaly_confirmation_delay_seconds == 90


def test_default_trading_schedule_matches_a_share_sessions(monkeypatch):
    monkeypatch.setattr(config, "_ENV_LOADED", False)
    monkeypatch.setattr(config, "_env_file_candidates", lambda: [])
    for key in [
        "TRADING_CALENDAR_PATH",
        "MORNING_OPEN_TIME",
        "MORNING_CLOSE_TIME",
        "AFTERNOON_OPEN_TIME",
        "AFTERNOON_CLOSE_TIME",
    ]:
        monkeypatch.delenv(key, raising=False)

    settings = Settings()

    assert settings.trading_calendar_path.as_posix().endswith(
        "server/data/etf-monitor/trading_calendar.json"
    )
    assert settings.morning_open_time == time(9, 30)
    assert settings.morning_close_time == time(11, 30)
    assert settings.afternoon_open_time == time(13, 0)
    assert settings.afternoon_close_time == time(15, 0)


def test_settings_loads_values_from_dotenv_file(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "ETF_SYMBOL=510300.SH",
                "VOLUME_RATIO_THRESHOLD=4.2",
                "HISTORICAL_AVG_DAYS=5",
                "ROLLING_WINDOW_MIN=8",
                "ROLLING_WINDOW_MAX=20",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(config, "_ENV_LOADED", False)
    monkeypatch.delenv("ETF_SYMBOL", raising=False)
    monkeypatch.delenv("VOLUME_RATIO_THRESHOLD", raising=False)
    monkeypatch.delenv("HISTORICAL_AVG_DAYS", raising=False)
    monkeypatch.delenv("ROLLING_WINDOW_MIN", raising=False)
    monkeypatch.delenv("ROLLING_WINDOW_MAX", raising=False)
    monkeypatch.delenv("LATE_SESSION_VOLUME_RATIO_THRESHOLD", raising=False)
    monkeypatch.delenv("LATE_SESSION_KLINE_PERIOD", raising=False)

    settings = Settings()

    assert settings.symbol == "510300.SH"
    assert settings.volume_ratio_threshold == 4.2
    assert not hasattr(settings, "historical_average_days")
    assert not hasattr(settings, "median_multiplier_threshold")
    assert settings.rolling_window_min == 8
    assert settings.rolling_window_max == 20
    assert settings.late_session_volume_ratio_threshold == 1.3
    assert settings.late_session_kline_period == "5"


def test_settings_loads_smtp_values_from_dotenv_file(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "EMAIL_ENABLED=true",
                "SMTP_HOST=smtp.example.com",
                "SMTP_PORT=465",
                "SMTP_USERNAME=monitor@example.com",
                "SMTP_PASSWORD=secret",
                "SMTP_FROM=monitor@example.com",
                "SMTP_TO=desk@example.com,pm@example.com",
                "SMTP_USE_SSL=true",
                "SMTP_STARTTLS=false",
                "SMTP_TIMEOUT_SECONDS=8",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(config, "_ENV_LOADED", False)
    for key in [
        "EMAIL_ENABLED",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USERNAME",
        "SMTP_PASSWORD",
        "SMTP_FROM",
        "SMTP_TO",
        "SMTP_USE_SSL",
        "SMTP_STARTTLS",
        "SMTP_TIMEOUT_SECONDS",
    ]:
        monkeypatch.delenv(key, raising=False)

    settings = Settings()

    assert settings.email_enabled is True
    assert settings.smtp_host == "smtp.example.com"
    assert settings.smtp_port == 465
    assert settings.smtp_username == "monitor@example.com"
    assert settings.smtp_password == "secret"
    assert settings.smtp_from == "monitor@example.com"
    assert settings.smtp_to == "desk@example.com,pm@example.com"
    assert settings.smtp_use_ssl is True
    assert settings.smtp_starttls is False
    assert settings.smtp_timeout_seconds == 8


def test_settings_loads_symbol_first_candle_times_from_dotenv_file(
    tmp_path, monkeypatch
):
    (tmp_path / ".env").write_text(
        "SYMBOL_FIRST_CANDLE_TIMES=513310.SH:10:45,159915.SZ:09:45\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(config, "_ENV_LOADED", False)
    monkeypatch.delenv("SYMBOL_FIRST_CANDLE_TIMES", raising=False)

    settings = Settings()

    assert settings.first_completed_candle_time_for("513310.SH") == time(10, 45)
    assert settings.first_completed_candle_time_for("159915.SZ") == time(9, 45)
    assert settings.should_wait_for_symbol_at(
        "513310.SH", time(10, 30)
    ) is False
    assert settings.should_wait_for_symbol_at(
        "513310.SH", time(10, 45)
    ) is True


def test_default_monitored_symbols_include_requested_etfs(monkeypatch):
    monkeypatch.setattr(config, "_ENV_LOADED", False)
    monkeypatch.setattr(config, "_env_file_candidates", lambda: [])
    monkeypatch.delenv("ETF_SYMBOLS", raising=False)

    settings = Settings()

    assert [(item.symbol, item.name) for item in settings.monitored_symbols()] == [
        ("588000.SH", "科创50ETF华夏"),
        ("159915.SZ", "创业板ETF易方达"),
        ("510300.SH", "沪深300ETF华泰柏瑞"),
        ("513310.SH", "中韩半导体ETF华泰柏瑞"),
    ]


def test_settings_loads_monitored_symbols_from_dotenv_file(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text(
        "ETF_SYMBOLS=159915.SZ:创业板ETF易方达,510310.SH:沪深300ETF易方达,588080.SH:科创50ETF易方达\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(config, "_ENV_LOADED", False)
    monkeypatch.delenv("ETF_SYMBOLS", raising=False)

    settings = Settings()

    assert [(item.symbol, item.name) for item in settings.monitored_symbols()] == [
        ("159915.SZ", "创业板ETF易方达"),
        ("510310.SH", "沪深300ETF易方达"),
        ("588080.SH", "科创50ETF易方达"),
    ]
