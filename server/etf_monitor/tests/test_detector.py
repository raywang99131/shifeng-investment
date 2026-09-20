from datetime import datetime

from app.config import Settings
from app.detector import detect_volume_spike
from app.models import Candle


def candle(
    time: str,
    volume: int,
    amount: float | None = None,
    open_price: float = 1.0,
    close_price: float = 1.05,
) -> Candle:
    return Candle(
        symbol="159915.SZ",
        name="创业板ETF易方达",
        time=datetime.fromisoformat(time),
        open=open_price,
        high=max(open_price, close_price, 1.1),
        low=min(open_price, close_price, 0.9),
        close=close_price,
        volume=volume,
        amount=amount if amount is not None else volume * 1.0,
    )


def prior_day_candles(
    dates: tuple[str, ...] = ("2026-07-16", "2026-07-17", "2026-07-20"),
    volume: int = 1000,
) -> list[Candle]:
    return [
        candle(f"{date}T{time}", volume)
        for date in dates
        for time in ("09:45:00", "10:00:00", "13:15:00")
    ]


def test_does_not_alert_when_current_volume_is_below_ratio_threshold():
    settings = Settings(volume_ratio_threshold=3.0)
    candles = prior_day_candles() + [
        candle("2026-07-21T09:45:00", 1200),
        candle("2026-07-21T10:00:00", 2500),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is None


def test_alerts_when_current_volume_exceeds_ratio_and_history_thresholds():
    settings = Settings(volume_ratio_threshold=3.0)
    candles = prior_day_candles() + [
        candle("2026-07-21T09:45:00", 1000),
        candle("2026-07-21T10:00:00", 1100),
        candle("2026-07-21T10:15:00", 950),
        candle("2026-07-21T10:30:00", 1050),
        candle("2026-07-21T10:45:00", 1025),
        candle("2026-07-21T11:00:00", 990),
        candle("2026-07-21T11:15:00", 1010),
        candle("2026-07-21T11:30:00", 980),
        candle("2026-07-21T13:15:00", 1200),
        candle("2026-07-21T13:30:00", 4200),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.symbol == "159915.SZ"
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T13:30:00")
    assert alert.volume == 4200
    assert alert.prev_volume == 1200
    assert alert.ratio == 3.5
    assert alert.severity == "warning"


def test_detects_spike_from_amount_even_when_volume_ratio_is_below_threshold():
    settings = Settings(volume_ratio_threshold=1.3)
    candles = [
        candle("2026-07-21T10:00:00", 10_000, amount=1_000_000),
        candle("2026-07-21T10:15:00", 11_000, amount=1_500_000),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.ratio == 1.5
    assert alert.volume == 1_500_000
    assert alert.prev_volume == 1_000_000
    assert "成交额放大" in alert.message


def test_does_not_alert_when_only_volume_exceeds_threshold_but_amount_does_not():
    settings = Settings(volume_ratio_threshold=1.3)
    candles = [
        candle("2026-07-21T10:00:00", 10_000, amount=1_000_000),
        candle("2026-07-21T10:15:00", 20_000, amount=1_100_000),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is None


def test_marks_critical_when_volume_ratio_exceeds_critical_threshold():
    settings = Settings(
        volume_ratio_threshold=3.0,
        critical_ratio_threshold=5.0,
    )
    candles = prior_day_candles() + [
        candle("2026-07-21T09:45:00", 1000),
        candle("2026-07-21T10:00:00", 1000),
        candle("2026-07-21T10:15:00", 1000),
        candle("2026-07-21T10:30:00", 1000),
        candle("2026-07-21T10:45:00", 1000),
        candle("2026-07-21T11:00:00", 1000),
        candle("2026-07-21T11:15:00", 1000),
        candle("2026-07-21T11:30:00", 1000),
        candle("2026-07-21T13:15:00", 1000),
        candle("2026-07-21T13:30:00", 5100),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.ratio == 5.1
    assert alert.severity == "critical"


def test_falls_back_to_previous_day_same_slot_when_same_day_previous_volume_is_zero():
    settings = Settings(volume_ratio_threshold=3.0)
    candles = prior_day_candles() + [
        candle("2026-07-21T09:45:00", 0),
        candle("2026-07-21T10:00:00", 5000),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T10:00:00")
    assert alert.prev_volume == 1000
    assert alert.ratio == 5.0


def test_opening_candle_compares_with_previous_trading_day_same_slot_not_close():
    settings = Settings(volume_ratio_threshold=3.0)
    candles = [
        candle("2026-07-20T09:45:00", 100),
        candle("2026-07-20T15:00:00", 10_000),
        candle("2026-07-21T09:45:00", 1000),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.alert_type == "volume_spike"
    assert alert.prev_volume == 100
    assert alert.ratio == 10.0


def test_first_candle_of_day_does_not_compare_with_previous_trading_day_close():
    settings = Settings(volume_ratio_threshold=3.0)
    candles = [
        candle("2026-07-20T09:45:00", 1000),
        candle("2026-07-20T15:00:00", 100),
        candle("2026-07-21T09:45:00", 1100),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is None


def test_afternoon_open_candle_compares_to_previous_trading_day_same_slot():
    settings = Settings(volume_ratio_threshold=3.0)
    candles = [
        candle("2026-07-20T11:30:00", 200),
        candle("2026-07-20T13:15:00", 1000),
        candle("2026-07-21T11:30:00", 250),
        candle("2026-07-21T13:15:00", 3600),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.alert_type == "volume_spike"
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T13:15:00")
    assert alert.prev_volume == 1000
    assert alert.ratio == 3.6


def test_afternoon_open_candle_does_not_compare_with_same_day_1130():
    settings = Settings(volume_ratio_threshold=3.0)
    candles = [
        candle("2026-07-20T13:15:00", 1000),
        candle("2026-07-21T11:30:00", 100),
        candle("2026-07-21T13:15:00", 250),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is None


def test_alerts_on_bearish_candle_when_volume_ratio_exceeds_threshold():
    settings = Settings(volume_ratio_threshold=3.0)
    candles = prior_day_candles() + [
        candle("2026-07-21T09:45:00", 1000),
        candle("2026-07-21T10:00:00", 1100),
        candle("2026-07-21T10:15:00", 4000, open_price=1.05, close_price=1.0),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.alert_type == "volume_spike"
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T10:15:00")
    assert alert.ratio == round(4000 / 1100, 2)


def test_alert_fires_when_ratio_breaks_through_after_drop_in_baseline():
    settings = Settings(
        volume_ratio_threshold=3.0,
        median_multiplier_threshold=0,
    )
    candles = prior_day_candles() + [
        candle("2026-07-21T09:45:00", 5000),
        candle("2026-07-21T10:00:00", 4800),
        candle("2026-07-21T10:15:00", 5100),
        candle("2026-07-21T10:30:00", 4900),
        candle("2026-07-21T10:45:00", 5000),
        candle("2026-07-21T11:00:00", 4700),
        candle("2026-07-21T11:15:00", 5200),
        candle("2026-07-21T11:30:00", 5050),
        candle("2026-07-21T13:15:00", 1000),
        candle("2026-07-21T13:30:00", 3200),
    ]

    alert = detect_volume_spike(candles, settings)

    # The 13:30 candle is 3.2x the immediately previous 13:15 candle,
    # so a spike alert fires with the previous candle as comparison.
    assert alert is not None
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T13:30:00")
    assert alert.prev_volume == 1000
    assert alert.ratio == 3.2


def test_alerts_even_when_current_volume_is_below_previous_three_day_average():
    settings = Settings(volume_ratio_threshold=2.0)
    candles = prior_day_candles(volume=6000) + [
        candle("2026-07-21T09:45:00", 1000),
        candle("2026-07-21T10:00:00", 2500),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T10:00:00")
    assert alert.ratio == 2.5


def test_alerts_without_enough_previous_trading_days_for_average():
    settings = Settings(volume_ratio_threshold=2.0)
    candles = prior_day_candles(dates=("2026-07-17", "2026-07-20")) + [
        candle("2026-07-21T09:45:00", 1000),
        candle("2026-07-21T10:00:00", 2600),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T10:00:00")
    assert alert.ratio == 2.6


def test_does_not_alert_shrink_when_ratio_falls_below_threshold():
    settings = Settings(volume_shrink_ratio_threshold=0.35)
    candles = [
        candle("2026-07-21T09:45:00", 5000),
        candle("2026-07-21T10:00:00", 5200),
        candle("2026-07-21T10:15:00", 4800),
        candle("2026-07-21T10:30:00", 5100),
        candle("2026-07-21T10:45:00", 5000),
        candle("2026-07-21T11:00:00", 4900),
        candle("2026-07-21T11:15:00", 5300),
        candle("2026-07-21T11:30:00", 5000),
        candle("2026-07-21T13:15:00", 6000),
        candle("2026-07-21T13:30:00", 1800),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is None


def test_does_not_mark_critical_when_shrink_breaks_critical_threshold():
    settings = Settings(
        volume_shrink_ratio_threshold=0.35,
        critical_shrink_ratio_threshold=0.2,
    )
    candles = [
        candle("2026-07-21T09:45:00", 5000),
        candle("2026-07-21T10:00:00", 5000),
        candle("2026-07-21T10:15:00", 5000),
        candle("2026-07-21T10:30:00", 5000),
        candle("2026-07-21T10:45:00", 5000),
        candle("2026-07-21T11:00:00", 5000),
        candle("2026-07-21T11:15:00", 5000),
        candle("2026-07-21T11:30:00", 5000),
        candle("2026-07-21T13:15:00", 5000),
        candle("2026-07-21T13:30:00", 900),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is None


def test_uses_late_session_threshold_for_candles_after_late_session_start():
    """A 1.3x spike at 14:35 should fire, but would not fire under the 2.0x day threshold."""
    settings = Settings(volume_ratio_threshold=2.0, median_multiplier_threshold=0)
    candles = [
        candle("2026-07-21T14:30:00", 1000),
        candle("2026-07-21T14:35:00", 1300),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is not None
    assert alert.alert_type == "volume_spike"
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T14:35:00")
    assert alert.ratio == 1.3
    assert alert.threshold == 1.3


def test_late_session_after_start_falls_back_to_previous_day_same_slot_when_sequential_ratio_is_below_threshold():
    settings = Settings(volume_ratio_threshold=2.0, median_multiplier_threshold=0)
    candles = [
        candle("2026-07-20T14:35:00", 900),
        candle("2026-07-21T14:30:00", 1000),
        candle("2026-07-21T14:35:00", 1200),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is not None
    assert alert.alert_type == "volume_spike"
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T14:35:00")
    assert alert.prev_volume == 900
    assert alert.ratio == 1.33
    assert alert.threshold == 1.3


def test_late_session_start_can_alert_from_regular_15m_ratio():
    settings = Settings(volume_ratio_threshold=1.5, median_multiplier_threshold=0)
    candles = [
        candle("2026-07-27T14:30:00", 180),
        candle("2026-07-28T14:15:00", 100),
        candle("2026-07-28T14:30:00", 200),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is not None
    assert alert.prev_volume == 100
    assert alert.ratio == 2.0
    assert alert.threshold == 1.5


def test_late_session_start_uses_regular_15m_rule_not_late_session_rule():
    settings = Settings(volume_ratio_threshold=1.5, median_multiplier_threshold=0)
    candles = [
        candle("2026-07-27T14:30:00", 900),
        candle("2026-07-28T14:15:00", 1000),
        candle("2026-07-28T14:30:00", 1600),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is not None
    assert alert.threshold == 1.5



def test_regular_15m_candle_uses_1_5x_day_threshold_before_1430():
    """A 1.8x spike at 14:15 should fire on the regular 15-minute day threshold."""
    settings = Settings(volume_ratio_threshold=1.5, median_multiplier_threshold=0)
    candles = [
        candle("2026-07-21T14:00:00", 1000),
        candle("2026-07-21T14:15:00", 1800),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is not None
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T14:15:00")
    assert alert.ratio == 1.8
    assert alert.threshold == 1.5


def test_opening_candle_uses_day_over_day_with_opening_threshold():
    """The first completed 15-minute K should compare to yesterday's same slot with 1.15x threshold."""
    settings = Settings(
        volume_ratio_threshold=3.0,
        median_multiplier_threshold=0,
        rolling_window_min=4,
    )
    candles = [
        candle("2026-07-20T09:45:00", 1000),
        candle("2026-07-21T09:45:00", 1150),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is not None
    assert alert.alert_type == "volume_spike"
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T09:45:00")
    assert alert.prev_volume == 1000
    assert alert.ratio == 1.15
    assert alert.threshold == 1.15



def test_opening_candle_does_not_alert_below_opening_threshold():
    """A 1.14x spike at the morning first completed K should NOT fire."""
    settings = Settings(
        volume_ratio_threshold=2.0,
        median_multiplier_threshold=0,
    )
    candles = [
        candle("2026-07-20T09:45:00", 1000),
        candle("2026-07-21T09:45:00", 1140),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is None


def test_afternoon_open_candle_uses_regular_threshold_not_opening_threshold():
    settings = Settings(volume_ratio_threshold=1.3, median_multiplier_threshold=0)
    candles = [
        candle("2026-07-20T13:15:00", 1000),
        candle("2026-07-21T11:30:00", 100),
        candle("2026-07-21T13:15:00", 1200),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is None


def test_regular_candle_uses_1_3x_day_threshold_before_1430():
    settings = Settings(volume_ratio_threshold=1.3, median_multiplier_threshold=0)
    candles = [
        candle("2026-07-21T14:00:00", 1000),
        candle("2026-07-21T14:15:00", 1300),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T14:15:00")
    assert alert.ratio == 1.3
    assert alert.threshold == 1.3



def test_opening_candle_marks_critical_at_3x():
    """A 3x opening spike should be marked critical (threshold = 3.0)."""
    settings = Settings(
        volume_ratio_threshold=1.5,
        median_multiplier_threshold=0,
    )
    candles = [
    candle("2026-07-20T09:45:00", 1000),
    candle("2026-07-21T09:45:00", 3000),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is not None
    assert alert.severity == "critical"
    assert alert.threshold == 3.0



def test_non_opening_candle_still_uses_day_threshold():
    """The 10:00 candle should use the regular 1.5x day threshold."""
    settings = Settings(
        volume_ratio_threshold=1.5,
        median_multiplier_threshold=0,
    )
    candles = [
    candle("2026-07-20T09:45:00", 1000),
    candle("2026-07-21T09:45:00", 1000),
    candle("2026-07-21T10:00:00", 1600),
    ]
    alert = detect_volume_spike(candles, settings)
    assert alert is not None
    assert alert.threshold == 1.5


def test_regular_candle_falls_back_to_previous_day_same_slot_when_sequential_ratio_is_below_threshold():
    settings = Settings(
        volume_ratio_threshold=1.5,
        median_multiplier_threshold=0,
    )
    candles = [
        candle("2026-07-20T10:15:00", 1000),
        candle("2026-07-21T10:00:00", 1500),
        candle("2026-07-21T10:15:00", 1800),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T10:15:00")
    assert alert.prev_volume == 1000
    assert alert.ratio == 1.8
    assert alert.threshold == 1.5


def test_regular_candle_falls_back_to_previous_day_same_slot_when_same_day_previous_is_missing():
    settings = Settings(
        volume_ratio_threshold=1.5,
        median_multiplier_threshold=0,
    )
    candles = [
        candle("2026-07-20T10:15:00", 1000),
        candle("2026-07-21T10:15:00", 1800),
    ]

    alert = detect_volume_spike(candles, settings)

    assert alert is not None
    assert alert.candle_time == datetime.fromisoformat("2026-07-21T10:15:00")
    assert alert.prev_volume == 1000
    assert alert.ratio == 1.8
    assert alert.threshold == 1.5
