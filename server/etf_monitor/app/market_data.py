from __future__ import annotations

from datetime import date, datetime, time
from zoneinfo import ZoneInfo
from typing import Protocol

from app.config import Settings
from app.models import Candle


TIME_COLUMNS = ["时间", "日期", "datetime", "time", "day"]
OPEN_COLUMNS = ["开盘", "open"]
HIGH_COLUMNS = ["最高", "high"]
LOW_COLUMNS = ["最低", "low"]
CLOSE_COLUMNS = ["收盘", "close"]
VOLUME_COLUMNS = ["成交量", "volume"]
AMOUNT_COLUMNS = ["成交额", "amount"]


class MarketDataClient(Protocol):
    def fetch_intraday_candles(self, symbol: str) -> list[Candle]:
        ...


class AkShareMarketDataClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def fetch_intraday_candles(self, symbol: str) -> list[Candle]:
        import akshare as ak

        normalized_symbol = normalize_symbol(symbol)
        sina = sina_symbol(symbol)

        now = datetime.now(ZoneInfo(self.settings.timezone))
        main_frame = _safe_fetch_frame(
            ak,
            normalized_symbol,
            sina,
            self.settings.kline_period,
            current_date=now.date(),
        )
        frames = []
        if main_frame is not None:
            if self.settings.is_late_session(now):
                frames.append(
                    (
                        _filter_frame_by_time(
                            main_frame, end_at=self.settings.late_session_start_time
                        ),
                        self.settings.kline_period,
                    )
                )
            else:
                frames.append((main_frame, self.settings.kline_period))

        if self.settings.is_late_session(now):
            late_frame = _safe_fetch_frame(
                ak,
                normalized_symbol,
                sina,
                self.settings.late_session_kline_period,
                current_date=now.date(),
            )
            if late_frame is not None:
                frames.append(
                    (
                        _filter_frame_by_time(
                            late_frame,
                            start_after=self.settings.late_session_start_time,
                            end_at=time(15, 0),
                        ),
                        self.settings.late_session_kline_period,
                    )
                )

        if not frames:
            return []

        candles: list[Candle] = []
        for frame, period in frames:
            if frame is None or frame.empty:
                continue
            previous_amount: float | None = None
            for _, row in frame.iterrows():
                time_value = _first_present(row, TIME_COLUMNS)
                close = float(_first_present(row, CLOSE_COLUMNS))
                raw_amount = float(_first_present(row, AMOUNT_COLUMNS, default=0.0))
                volume, amount = _normalized_volume_and_amount(
                    row, close, raw_amount, previous_amount
                )
                if amount > 0:
                    previous_amount = amount
                candles.append(
                    Candle(
                        symbol=symbol,
                        name=self.settings.name_for_symbol(symbol),
                        time=_parse_time(time_value),
                        open=float(_first_present(row, OPEN_COLUMNS)),
                        high=float(_first_present(row, HIGH_COLUMNS)),
                        low=float(_first_present(row, LOW_COLUMNS)),
                        close=close,
                        volume=volume,
                        amount=amount,
                        kline_period=period,
                    )
                )
        return sorted(candles, key=lambda item: (item.time, int(item.kline_period)))


def normalize_symbol(symbol: str) -> str:
    return symbol.split(".")[0]


def sina_symbol(symbol: str) -> str:
    code = normalize_symbol(symbol)
    suffix = symbol.split(".")[-1].upper() if "." in symbol else ""
    if suffix == "SH" or code.startswith(("5", "6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def _first_present(row, names: list[str], default=None):
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    if default is not None:
        return default
    raise KeyError(f"missing any of columns: {', '.join(names)}")


def _normalized_volume(row, close: float, amount: float) -> int:
    volume, _ = _normalized_volume_and_amount(row, close, amount, None)
    return volume


def _normalized_volume_and_amount(
    row,
    close: float,
    amount: float,
    previous_amount: float | None,
) -> tuple[int, float]:
    volume = int(float(_first_present(row, VOLUME_COLUMNS)))
    if volume <= 0 or close <= 0 or amount <= 0:
        return volume, amount

    implied_multiplier = amount / (close * volume)
    if 50 <= implied_multiplier <= 150:
        return volume * 100, amount

    if (
        previous_amount is not None
        and previous_amount >= 10_000_000
        and amount <= previous_amount * 0.05
        and amount * 100 >= previous_amount * 0.03
    ):
        return volume * 100, amount * 100

    return volume, amount


def _parse_time(value) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


def _filter_frame_by_time(
    frame,
    start_at: time | None = None,
    start_after: time | None = None,
    end_at: time | None = None,
    end_before: time | None = None,
):
    keep = []
    for _, row in frame.iterrows():
        candle_time = _parse_time(_first_present(row, TIME_COLUMNS)).time()
        if start_at is not None and candle_time < start_at:
            keep.append(False)
            continue
        if start_after is not None and candle_time <= start_after:
            keep.append(False)
            continue
        if end_at is not None and candle_time > end_at:
            keep.append(False)
            continue
        if end_before is not None and candle_time >= end_before:
            keep.append(False)
            continue
        keep.append(True)
    return frame.loc[keep]


def _safe_fetch_frame(
    ak,
    normalized_symbol: str,
    sina: str,
    period: str,
    current_date=None,
):
    try:
        frame = ak.fund_etf_hist_min_em(
            symbol=normalized_symbol,
            period=period,
            adjust="",
        )
    except Exception:
        tencent_frame = None
        if current_date is not None:
            try:
                tencent_frame = _fetch_tencent_intraday_frame(
                    sina,
                    period,
                    current_date,
                )
            except Exception:
                tencent_frame = None
        if tencent_frame is not None:
            return tencent_frame

        try:
            frame = ak.stock_zh_a_minute(
                symbol=sina,
                period=period,
                adjust="",
            )
        except Exception:
            return None
    if frame is None or frame.empty:
        return None
    return frame


def _frame_contains_date(frame, target_date) -> bool:
    if frame is None or frame.empty:
        return False
    for _, row in frame.iterrows():
        try:
            if _parse_time(_first_present(row, TIME_COLUMNS)).date() == target_date:
                return True
        except (KeyError, ValueError):
            continue
    return False


def _fetch_tencent_intraday_frame(sina: str, period: str, current_date: date):
    import pandas as pd
    import requests

    response = requests.get(
        "https://web.ifzq.gtimg.cn/appstock/app/minute/query",
        params={"code": sina},
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    symbol_data = payload.get("data", {}).get(sina, {}).get("data", {})
    response_date = datetime.strptime(str(symbol_data.get("date")), "%Y%m%d").date()
    if response_date != current_date:
        return None

    minute_rows = []
    for item in symbol_data.get("data", []):
        raw_time, raw_price, raw_volume, raw_amount = str(item).split()
        minute_rows.append(
            {
                "time": time(int(raw_time[:2]), int(raw_time[2:])),
                "price": float(raw_price),
                "volume": int(raw_volume),
                "amount": float(raw_amount),
            }
        )
    if not minute_rows:
        return None

    period_minutes = int(period)
    rows = []
    previous_volume = 0
    previous_amount = 0.0
    previous_index = -1
    for index, row in enumerate(minute_rows):
        if not _is_tencent_bar_endpoint(row["time"], period_minutes):
            continue

        part = minute_rows[previous_index + 1 : index + 1]
        if not part:
            continue
        rows.append(
            {
                "datetime": datetime.combine(current_date, row["time"]),
                "open": part[0]["price"],
                "high": max(item["price"] for item in part),
                "low": min(item["price"] for item in part),
                "close": part[-1]["price"],
                "volume": (row["volume"] - previous_volume) * 100,
                "amount": row["amount"] - previous_amount,
            }
        )
        previous_volume = row["volume"]
        previous_amount = row["amount"]
        previous_index = index

    if not rows:
        return None
    return pd.DataFrame(rows)


def _is_tencent_bar_endpoint(value: time, period_minutes: int) -> bool:
    for session_start, session_end in ((time(9, 30), time(11, 30)), (time(13, 0), time(15, 0))):
        if value < session_start or value > session_end:
            continue
        elapsed = (value.hour * 60 + value.minute) - (
            session_start.hour * 60 + session_start.minute
        )
        return elapsed > 0 and elapsed % period_minutes == 0
    return False


def _concat_frames(frames):
    import pandas as pd

    parts = [frame for frame in frames if frame is not None and not frame.empty]
    if not parts:
        return None
    return pd.concat(parts, ignore_index=True).drop_duplicates()
