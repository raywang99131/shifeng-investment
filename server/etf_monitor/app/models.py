from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


Severity = Literal["warning", "critical"]
AlertType = Literal["volume_spike"]
DataStatus = Literal["live", "cached", "degraded", "empty"]


class Candle(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    symbol: str
    name: str
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    amount: float
    kline_period: str = "15"


class AlertCreate(BaseModel):
    symbol: str
    name: str
    alert_type: AlertType = "volume_spike"
    candle_time: datetime
    volume: float
    prev_volume: float
    ratio: float
    threshold: float
    severity: Severity
    message: str


class AlertLog(AlertCreate):
    id: int
    created_at: datetime


class MonitorSnapshot(BaseModel):
    symbol: str
    name: str
    data_status: DataStatus
    latest_candle: Candle | None
    candles: list[Candle]
    current_alert: AlertLog | None
    last_updated: datetime | None
    error: str | None = None


class PollResponse(BaseModel):
    symbol: str
    data_status: DataStatus
    candle_count: int
    alert: AlertLog | None
    error: str | None = None


class AlertListResponse(BaseModel):
    alerts: list[AlertLog]


class SymbolInfo(BaseModel):
    symbol: str
    name: str


class SymbolListResponse(BaseModel):
    symbols: list[SymbolInfo]


class PollAllResponse(BaseModel):
    results: list[PollResponse]


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    symbol: str
    data_status: DataStatus
    last_updated: datetime | None
    error: str | None = None
