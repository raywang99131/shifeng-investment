import pandas as pd
from datetime import datetime as real_datetime

from app.config import Settings
from app import market_data as market_data_module
from app.market_data import AkShareMarketDataClient


def test_akshare_client_pulls_only_15m_during_main_session(monkeypatch):
    import akshare as ak
    import requests

    # Pin the clock to the main session (before late_session_start_time).
    monkeypatch.setattr(Settings, "is_late_session", lambda self, candle_time: False)

    calls: list[tuple[str, str]] = []

    def failing_eastmoney(*args, **kwargs):
        raise RuntimeError("eastmoney unavailable")

    def working_sina(symbol: str, period: str, adjust: str):
        calls.append((symbol, period))
        return pd.DataFrame(
            [
                {
                    "day": "2026-07-21 11:15:00",
                    "open": 3.568,
                    "high": 3.630,
                    "low": 3.567,
                    "close": 3.595,
                    "volume": 367796290,
                    "amount": 1324330357.1699,
                },
                {
                    "day": "2026-07-21 11:30:00",
                    "open": 3.596,
                    "high": 3.647,
                    "low": 3.589,
                    "close": 3.644,
                    "volume": 241405916,
                    "amount": 872506583.0357,
                },
            ]
            )

    def failing_tencent(*args, **kwargs):
        raise RuntimeError("tencent unavailable")

    monkeypatch.setattr(ak, "fund_etf_hist_min_em", failing_eastmoney)
    monkeypatch.setattr(requests, "get", failing_tencent)
    monkeypatch.setattr(ak, "stock_zh_a_minute", working_sina)

    client = AkShareMarketDataClient(Settings())

    candles = client.fetch_intraday_candles("159915.SZ")

    assert calls == [("sz159915", "15")]
    assert len(candles) == 2
    assert candles[-1].time.isoformat() == "2026-07-21T11:30:00"
    assert candles[-1].open == 3.596
    assert candles[-1].close == 3.644
    assert candles[-1].volume == 241405916


def test_akshare_client_combines_15m_main_session_with_5m_late_session(monkeypatch):
    import akshare as ak

    # Pin the clock to the late session (at or after late_session_start_time).
    monkeypatch.setattr(Settings, "is_late_session", lambda self, candle_time: True)

    calls: list[tuple[str, str]] = []

    def working_eastmoney(symbol: str, period: str, adjust: str):
        calls.append((symbol, period))
        if period == "15":
            return pd.DataFrame(
                [
                    {
                        "datetime": "2026-07-28 14:15:00",
                        "open": 1.0,
                        "high": 1.1,
                        "low": 0.9,
                        "close": 1.0,
                        "volume": 1500,
                        "amount": 1500.0,
                    },
                    {
                        "datetime": "2026-07-28 14:30:00",
                        "open": 1.0,
                        "high": 1.1,
                        "low": 0.9,
                        "close": 1.0,
                        "volume": 3000,
                        "amount": 3000.0,
                    },
                ]
            )
        return pd.DataFrame(
            [
                {
                    "datetime": "2026-07-28 14:25:00",
                    "open": 1.0,
                    "high": 1.0,
                    "low": 1.0,
                    "close": 1.0,
                    "volume": 2500,
                    "amount": 2500.0,
                },
                {
                    "datetime": "2026-07-28 14:30:00",
                    "open": 1.0,
                    "high": 1.0,
                    "low": 1.0,
                    "close": 1.0,
                    "volume": 500,
                    "amount": 500.0,
                },
                {
                    "datetime": "2026-07-28 14:35:00",
                    "open": 1.0,
                    "high": 1.0,
                    "low": 1.0,
                    "close": 1.0,
                    "volume": 1000,
                    "amount": 1000.0,
                }
            ]
        )

    monkeypatch.setattr(ak, "fund_etf_hist_min_em", working_eastmoney)

    client = AkShareMarketDataClient(Settings())

    candles = client.fetch_intraday_candles("510300.SH")

    assert calls == [("510300", "15"), ("510300", "5")]
    assert [
        (candle.time.isoformat(), candle.volume, candle.kline_period)
        for candle in candles
    ] == [
        ("2026-07-28T14:15:00", 1500, "15"),
        ("2026-07-28T14:30:00", 3000, "15"),
        ("2026-07-28T14:35:00", 1000, "5"),
    ]


def test_akshare_client_normalizes_lot_based_minute_volume(monkeypatch):
    import akshare as ak

    def eastmoney_with_lot_volume(*args, **kwargs):
        return pd.DataFrame(
            [
                {
                    "datetime": "2026-07-22 14:45:00",
                    "open": 1.998,
                    "high": 2.001,
                    "low": 1.995,
                    "close": 2.000,
                    "volume": 300321,
                    "amount": 60064200.0,
                }
            ]
        )

    monkeypatch.setattr(ak, "fund_etf_hist_min_em", eastmoney_with_lot_volume)

    client = AkShareMarketDataClient(Settings())

    candles = client.fetch_intraday_candles("510310.SH")

    assert candles[0].volume == 30032100


def test_akshare_client_normalizes_mixed_lot_based_minute_amount(monkeypatch):
    import akshare as ak
    import requests

    def failing_eastmoney(*args, **kwargs):
        raise RuntimeError("eastmoney unavailable")

    def sina_with_mixed_units(symbol: str, period: str, adjust: str):
        return pd.DataFrame(
            [
                {
                    "day": "2026-08-06 09:45:00",
                    "open": 3.540,
                    "high": 3.574,
                    "low": 3.540,
                    "close": 3.545,
                    "volume": 77_874_040,
                    "amount": 277_336_598.0399,
                },
                {
                    "day": "2026-08-06 10:00:00",
                    "open": 3.544,
                    "high": 3.562,
                    "low": 3.531,
                    "close": 3.559,
                    "volume": 866_400,
                    "amount": 3_075_432.4004,
                },
            ]
            )

    def failing_tencent(*args, **kwargs):
        raise RuntimeError("tencent unavailable")

    monkeypatch.setattr(ak, "fund_etf_hist_min_em", failing_eastmoney)
    monkeypatch.setattr(requests, "get", failing_tencent)
    monkeypatch.setattr(ak, "stock_zh_a_minute", sina_with_mixed_units)

    client = AkShareMarketDataClient(Settings())

    candles = client.fetch_intraday_candles("159915.SZ")

    assert candles[0].volume == 77_874_040
    assert candles[0].amount == 277_336_598.0399
    assert candles[1].volume == 86_640_000
    assert candles[1].amount == 307_543_240.04


def test_akshare_client_uses_tencent_for_unreliable_current_day_stock_fallback(
    monkeypatch,
):
    import akshare as ak
    import requests

    class FrozenDateTime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime(2026, 8, 7, 11, 27, tzinfo=tz)

    def failing_eastmoney(*args, **kwargs):
        raise RuntimeError("eastmoney unavailable")

    def current_day_sina(symbol: str, period: str, adjust: str):
        return pd.DataFrame(
            [
                {
                    "day": "2026-08-07 10:00:00",
                    "open": 3.544,
                    "high": 3.562,
                    "low": 3.531,
                    "close": 3.559,
                    "volume": 866_400,
                    "amount": 3_075_432.4004,
                },
            ]
        )

    class TencentResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "code": 0,
                "msg": "",
                "data": {
                    "sz159915": {
                        "data": {
                            "date": "20260807",
                            "data": [
                                "0930 3.540 75788 26828952.00",
                                "0931 3.570 555705 197711138.70",
                                "0932 3.565 1025294 365247750.05",
                                "0933 3.569 1221430 435234960.45",
                                "0934 3.561 1428744 509166094.95",
                                "0935 3.554 1622132 577955348.75",
                                "0936 3.558 1864001 664011256.45",
                                "0937 3.567 1998423 711905661.65",
                                "0938 3.573 2153391 767252524.35",
                                "0939 3.565 2315469 825078876.75",
                                "0940 3.561 2450554 873218940.95",
                                "0941 3.570 2664384 949467033.95",
                                "0942 3.557 2877333 1025398874.45",
                                "0943 3.559 2999235 1068782439.45",
                                "0944 3.557 3105340 1106557276.66",
                                "0945 3.544 3281663 1169114607.15",
                                "0946 3.540 3519078 1253241610.14",
                                "0947 3.532 3659593 1302918572.03",
                                "0948 3.543 3879764 1380711900.33",
                                "0949 3.544 4071960 1448798414.10",
                                "0950 3.554 4207139 1496822024.00",
                                "0951 3.544 4418552 1571854928.28",
                                "0952 3.555 4534048 1612856885.68",
                                "0953 3.553 4671375 1661668514.37",
                                "0954 3.548 4751957 1690268021.43",
                                "0955 3.546 4858528 1728052599.32",
                                "0956 3.555 4926049 1752011087.22",
                                "0957 3.562 5061387 1800165801.12",
                                "0958 3.562 5167464 1837941538.22",
                                "0959 3.565 5239228 1863512958.68",
                                "1000 3.559 5309682 1888599326.58",
                            ],
                        }
                    }
                },
            }

    def tencent_get(*args, **kwargs):
        return TencentResponse()

    monkeypatch.setattr(market_data_module, "datetime", FrozenDateTime)
    monkeypatch.setattr(ak, "fund_etf_hist_min_em", failing_eastmoney)
    monkeypatch.setattr(ak, "stock_zh_a_minute", current_day_sina)
    monkeypatch.setattr(requests, "get", tencent_get)

    client = AkShareMarketDataClient(Settings())

    candles = client.fetch_intraday_candles("159915.SZ")

    assert [(item.time.strftime("%H:%M"), item.volume, round(item.amount, 2)) for item in candles] == [
        ("09:45", 328_166_300, 1_169_114_607.15),
        ("10:00", 202_801_900, 719_484_719.43),
    ]


def test_akshare_client_uses_tencent_current_day_fallback_for_other_symbols(
    monkeypatch,
):
    import akshare as ak
    import requests

    class FrozenDateTime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime(2026, 8, 7, 11, 27, tzinfo=tz)

    def failing_eastmoney(*args, **kwargs):
        raise RuntimeError("eastmoney unavailable")

    def should_not_use_sina(symbol: str, period: str, adjust: str):
        raise AssertionError("Sina should not be used when Tencent returns data")

    class TencentResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "code": 0,
                "msg": "",
                "data": {
                    "sh510300": {
                        "data": {
                            "date": "20260807",
                            "data": [
                                "0930 4.700 100 47000.00",
                                "0931 4.710 200 94100.00",
                                "0945 4.720 1000 471000.00",
                                "1000 4.730 1500 707500.00",
                            ],
                        }
                    }
                },
            }

    def tencent_get(*args, **kwargs):
        return TencentResponse()

    monkeypatch.setattr(market_data_module, "datetime", FrozenDateTime)
    monkeypatch.setattr(ak, "fund_etf_hist_min_em", failing_eastmoney)
    monkeypatch.setattr(ak, "stock_zh_a_minute", should_not_use_sina)
    monkeypatch.setattr(requests, "get", tencent_get)

    client = AkShareMarketDataClient(Settings())

    candles = client.fetch_intraday_candles("510300.SH")

    assert [(item.time.strftime("%H:%M"), item.volume, item.amount) for item in candles] == [
        ("09:45", 100_000, 471_000.0),
        ("10:00", 50_000, 236_500.0),
    ]


def test_akshare_client_uses_stock_minute_when_tencent_fallback_fails(monkeypatch):
    import akshare as ak
    import requests

    class FrozenDateTime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime(2026, 8, 7, 11, 27, tzinfo=tz)

    def failing_eastmoney(*args, **kwargs):
        raise RuntimeError("eastmoney unavailable")

    def failing_tencent(*args, **kwargs):
        raise RuntimeError("tencent unavailable")

    def working_sina(symbol: str, period: str, adjust: str):
        return pd.DataFrame(
            [
                {
                    "day": "2026-08-07 10:00:00",
                    "open": 1.0,
                    "high": 1.1,
                    "low": 0.9,
                    "close": 1.0,
                    "volume": 10_000,
                    "amount": 10_000.0,
                },
            ]
        )

    monkeypatch.setattr(market_data_module, "datetime", FrozenDateTime)
    monkeypatch.setattr(ak, "fund_etf_hist_min_em", failing_eastmoney)
    monkeypatch.setattr(requests, "get", failing_tencent)
    monkeypatch.setattr(ak, "stock_zh_a_minute", working_sina)

    client = AkShareMarketDataClient(Settings())

    candles = client.fetch_intraday_candles("510300.SH")

    assert len(candles) == 1
    assert candles[0].amount == 10_000.0
