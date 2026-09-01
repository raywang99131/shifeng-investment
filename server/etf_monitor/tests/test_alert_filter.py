from datetime import datetime

from app.models import AlertCreate
from app.store import AlertStore


def alert(candle_time: str, alert_type: str) -> AlertCreate:
    ratio = 2.5 if alert_type == "volume_spike" else 0.4
    return AlertCreate(
        symbol="510310.SH",
        name="沪深300ETF易方达",
        alert_type=alert_type,
        candle_time=datetime.fromisoformat(candle_time),
        volume=1000,
        prev_volume=400,
        ratio=ratio,
        threshold=2.0 if alert_type == "volume_spike" else 0.5,
        severity="warning",
        message="test alert",
    )


def test_list_alerts_returns_only_volume_spike_alerts_by_default(tmp_path):
    store = AlertStore(tmp_path / "alerts.db")
    with store._connect() as connection:
        connection.execute(
            """
            INSERT INTO alerts (
                symbol, name, alert_type, candle_time, volume, prev_volume, ratio,
                threshold, severity, message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "510310.SH",
                "沪深300ETF易方达",
                "volume_shrink",
                "2026-07-21T10:00:00",
                1000,
                400,
                0.4,
                0.5,
                "warning",
                "legacy shrink alert",
            ),
        )
    store.save_alert(alert("2026-07-21T10:15:00", "volume_spike"))

    alerts = store.list_alerts("510310.SH", limit=10)

    assert len(alerts) == 1
    assert alerts[0].alert_type == "volume_spike"
    assert alerts[0].candle_time == datetime.fromisoformat("2026-07-21T10:15:00")
