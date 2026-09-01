from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.market_data import AkShareMarketDataClient, MarketDataClient
from app.models import (
    AlertListResponse,
    HealthResponse,
    MonitorSnapshot,
    PollAllResponse,
    PollResponse,
    SymbolListResponse,
)
from app.notifier import AlertNotifier, SMTPAlertNotifier
from app.scheduler import PollScheduler
from app.service import MonitorService


def create_app(
    db_path: str | Path | None = None,
    market_data_client: MarketDataClient | None = None,
    scheduler_enabled: bool | None = None,
    settings: Settings | None = None,
    notifier: AlertNotifier | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_db_path = Path(db_path or resolved_settings.db_path)
    resolved_market_data_client = market_data_client or AkShareMarketDataClient(
        resolved_settings
    )
    resolved_notifier = notifier or SMTPAlertNotifier(resolved_settings)
    service = MonitorService(
        settings=resolved_settings,
        market_data_client=resolved_market_data_client,
        db_path=resolved_db_path,
        notifier=resolved_notifier,
    )
    should_run_scheduler = (
        resolved_settings.scheduler_enabled
        if scheduler_enabled is None
        else scheduler_enabled
    )
    scheduler = PollScheduler(service, resolved_settings.poll_interval_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if should_run_scheduler:
            scheduler.start()
        yield
        scheduler.stop()

    app = FastAPI(title="ETF Volume Monitor", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[resolved_settings.cors_origin, "http://127.0.0.1:5174"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.monitor_service = service

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        data_status, last_updated, error = service.health()
        return HealthResponse(
            status="ok" if data_status in {"live", "cached"} else "degraded",
            symbol=resolved_settings.symbol,
            data_status=data_status,
            last_updated=last_updated,
            error=error,
        )

    @app.get("/api/monitor/snapshot", response_model=MonitorSnapshot)
    def snapshot(symbol: str = Query(default=resolved_settings.symbol)) -> MonitorSnapshot:
        return service.snapshot(symbol)

    @app.get("/api/monitor/symbols", response_model=SymbolListResponse)
    def symbols() -> SymbolListResponse:
        return SymbolListResponse(symbols=service.list_symbols())

    @app.get("/api/alerts", response_model=AlertListResponse)
    def alerts(
        symbol: str = Query(default=resolved_settings.symbol),
        limit: int = Query(default=100, ge=1, le=500),
    ) -> AlertListResponse:
        return AlertListResponse(alerts=service.list_alerts(symbol, limit))

    @app.post("/api/monitor/poll", response_model=PollResponse)
    def poll(symbol: str = Query(default=resolved_settings.symbol)) -> PollResponse:
        return service.poll(symbol)

    @app.post("/api/monitor/poll-all", response_model=PollAllResponse)
    def poll_all() -> PollAllResponse:
        return PollAllResponse(results=service.poll_all())

    return app


app = create_app()
