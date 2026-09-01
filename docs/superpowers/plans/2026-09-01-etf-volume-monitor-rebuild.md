# ETF Volume Monitor Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Rebuild the broken ETF turnover anomaly card as a repository-owned service that serves durable cached data and polls automatically only during A-share trading sessions.

**Architecture:** Vendor the supplied FastAPI/AkShare/SQLite monitor under server/etf_monitor, then add a cache-only snapshot API and a Shanghai-session-aware scheduler. Keep Express as the public aggregation boundary, supervise Python from the normal local Node entrypoint, and run it as a separate Docker service in Compose.

**Tech Stack:** Python 3, FastAPI, Uvicorn, AkShare, Pydantic, SQLite, pytest, Node.js, Express, React, TypeScript, Docker Compose

**Spec:** docs/superpowers/specs/2026-09-01-etf-volume-monitor-rebuild-design.md

## Global Constraints

- Do not depend on the Downloads reference folder or $HOME/Desktop/etf_monitor at runtime.
- Preserve the reference monitor's multi-symbol, 15/5-minute, amount-normalization, alert-deduplication, SQLite, and email behavior unless a failing regression test proves a defect.
- Use Asia/Shanghai; automatic polling runs only during 09:30–11:30 and 13:00–15:00 on resolved A-share trading days.
- A service started during an active session polls immediately; lunch, post-close, weekends, and resolved holidays do not call the quote source.
- GET /api/monitor/cached-snapshot never calls a market-data provider.
- Page refreshes read cache; only the scheduler and explicit POST /api/monitor/poll-all fetch live data.
- One symbol failure does not prevent other symbols from being cached or displayed.
- Missing live data is labeled cached, empty, or degraded; failure never advances a live timestamp.
- Do not commit secrets, SQLite databases, virtual environments, logs, reference .run files, reference .tmp_apply files, or backups.
- Preserve unrelated dirty-worktree changes and stage only ETF files.

---

## File Structure

- server/etf_monitor/app/config.py — symbols, thresholds, paths, and schedule configuration.
- server/etf_monitor/app/models.py — Pydantic API models.
- server/etf_monitor/app/market_data.py — AkShare/Tencent fetching and normalization.
- server/etf_monitor/app/detector.py — turnover spike rules.
- server/etf_monitor/app/store.py — SQLite schema, candles, alerts, and deduplication.
- server/etf_monitor/app/notifier.py — optional SMTP notifications.
- server/etf_monitor/app/service.py — polling, cache snapshots, and detection orchestration.
- server/etf_monitor/app/trading_calendar.py — cached A-share trading-day resolution.
- server/etf_monitor/app/scheduler.py — trading-session state machine.
- server/etf_monitor/app/main.py — FastAPI routes and lifecycle.
- server/etf_monitor/tests/ — imported regressions and new schedule/cache tests.
- server/api/etf_monitor.js — Express aggregation boundary.
- server/lib/etfMonitorProcess.js — local Python child supervision.
- src/pages/TMTMargin/etfMonitorState.ts — pure UI state mapping.
- scripts/cloudflare-tunnel.sh — one owner for local startup.
- server/etf_monitor/Dockerfile and docker-compose.yml — container sidecar.
- server/data/etf-monitor/ — ignored persistent database and calendar cache.

---

### Task 1: Vendor the supplied monitor and regression suite

**Files:**
- Create: server/etf_monitor/app/__init__.py
- Create: server/etf_monitor/app/config.py
- Create: server/etf_monitor/app/detector.py
- Create: server/etf_monitor/app/main.py
- Create: server/etf_monitor/app/market_data.py
- Create: server/etf_monitor/app/models.py
- Create: server/etf_monitor/app/notifier.py
- Create: server/etf_monitor/app/scheduler.py
- Create: server/etf_monitor/app/service.py
- Create: server/etf_monitor/app/store.py
- Create: server/etf_monitor/tests/conftest.py
- Create: server/etf_monitor/tests/test_alert_filter.py
- Create: server/etf_monitor/tests/test_api.py
- Create: server/etf_monitor/tests/test_config.py
- Create: server/etf_monitor/tests/test_detector.py
- Create: server/etf_monitor/tests/test_market_data.py
- Create: server/etf_monitor/tests/test_notifier.py
- Create: server/etf_monitor/tests/test_service.py
- Create: server/etf_monitor/tests/test_store.py
- Create: server/etf_monitor/requirements.txt
- Create: server/etf_monitor/requirements-dev.txt
- Modify: .gitignore

**Interfaces:**
- Consumes: current working-tree contents of the supplied reference backend/app and backend/tests.
- Produces: importable app package, create_app() -> FastAPI, MonitorService, AlertStore, and the full reference regression suite.

- [ ] **Step 1: Add the reference tests before application code**

Transfer the complete current contents of the nine reference backend/tests files. Preserve conftest.py path insertion so imports resolve when pytest runs from server/etf_monitor.

- [ ] **Step 2: Prove the application is absent**

Run:

    python3 -m pytest server/etf_monitor/tests/test_detector.py -q --rootdir server/etf_monitor

Expected: collection fails with ModuleNotFoundError for app.

- [ ] **Step 3: Add the supplied implementation and dependencies**

Transfer the complete current contents of reference backend/app and both requirements files. Exclude .env, database files, bytecode, logs, temporary scripts, front-end files, and backups.

Change only the default database path in config.py:

    db_path: Path = Field(
        default_factory=lambda: Path(
            _str_env("DB_PATH", "server/data/etf-monitor/etf_monitor.db")
        )
    )

Append to .gitignore:

    server/data/etf-monitor/
    server/etf_monitor/.pytest_cache/
    server/etf_monitor/.pytest_tmp/
    server/etf_monitor/**/__pycache__/

- [ ] **Step 4: Install dependencies in the project Python runtime**

Run:

    server/data/python-venv/bin/python3 -m pip install       -r server/etf_monitor/requirements-dev.txt

Expected: FastAPI, Uvicorn, Pydantic, pytest, httpx, and AkShare import from the same interpreter.

- [ ] **Step 5: Run the imported regression suite**

Run:

    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests -q       --basetemp /private/tmp/shifeng-etf-reference-tests

Expected: all reference tests pass.

- [ ] **Step 6: Commit the baseline**

    git add .gitignore server/etf_monitor
    git commit -m "feat: vendor ETF volume monitor service"

---

### Task 2: Add a cache-only snapshot API

**Files:**
- Modify: server/etf_monitor/app/service.py
- Modify: server/etf_monitor/app/main.py
- Test: server/etf_monitor/tests/test_api.py
- Test: server/etf_monitor/tests/test_service.py

**Interfaces:**
- Consumes: AlertStore.list_candles(), completed-candle filtering, and current-alert lookup.
- Produces: MonitorService.cached_snapshot(symbol=None) -> MonitorSnapshot and GET /api/monitor/cached-snapshot.

- [ ] **Step 1: Write the failing service test**

    class MustNotFetchMarketData:
        def fetch_intraday_candles(self, symbol: str):
            raise AssertionError("cached snapshot must not fetch market data")

    def test_cached_snapshot_reads_sqlite_without_market_request(tmp_path):
        settings = Settings(
            db_path=tmp_path / "monitor.db",
            scheduler_enabled=False,
        )
        service = MonitorService(
            settings,
            MustNotFetchMarketData(),
            settings.db_path,
        )
        candle = candle_at(
            "2026-09-01T10:00:00",
            symbol="159915.SZ",
            amount=12_000_000,
        )
        service.candle_cache.upsert_candles([candle])

        snapshot = service.cached_snapshot("159915.SZ")

        assert snapshot.data_status == "cached"
        assert snapshot.latest_candle == candle
        assert snapshot.error is None

Use the existing candle fixture name in test_service.py rather than duplicating model construction.

- [ ] **Step 2: Write the failing route test**

    def test_cached_snapshot_endpoint_never_calls_market_data(tmp_path):
        app = create_app(
            db_path=tmp_path / "monitor.db",
            market_data_client=MustNotFetchMarketData(),
            scheduler_enabled=False,
        )
        app.state.monitor_service.candle_cache.upsert_candles([
            candle_at("2026-09-01T10:00:00", amount=12_000_000)
        ])

        with TestClient(app) as client:
            response = client.get(
                "/api/monitor/cached-snapshot?symbol=159915.SZ"
            )

        assert response.status_code == 200
        assert response.json()["data_status"] == "cached"

- [ ] **Step 3: Verify red**

    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests/test_service.py       server/etf_monitor/tests/test_api.py -q       --basetemp /private/tmp/shifeng-etf-cache-red

Expected: cached_snapshot and the route are missing.

- [ ] **Step 4: Implement the minimal cache read**

Add to MonitorService:

    def cached_snapshot(
        self,
        symbol: str | None = None,
    ) -> MonitorSnapshot:
        requested_symbol = symbol or self.settings.symbol
        candles = self.candle_cache.list_candles(
            requested_symbol,
            limit=500,
        )
        candles = _completed_candles(candles, self.settings)
        candles = _snapshot_candles(candles, self.settings)
        latest = candles[-1] if candles else None
        return MonitorSnapshot(
            symbol=requested_symbol,
            name=self.settings.name_for_symbol(requested_symbol),
            data_status="cached" if latest else "empty",
            latest_candle=latest,
            candles=candles[-80:],
            current_alert=self._current_alert(requested_symbol, latest),
            last_updated=latest.time if latest else None,
            error=None,
        )

The method does not change service last_status or last_error.

Add to main.py:

    @app.get(
        "/api/monitor/cached-snapshot",
        response_model=MonitorSnapshot,
    )
    def cached_snapshot(
        symbol: str = Query(default=resolved_settings.symbol),
    ) -> MonitorSnapshot:
        return service.cached_snapshot(symbol)

- [ ] **Step 5: Verify green and regression safety**

    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests/test_service.py       server/etf_monitor/tests/test_api.py -q       --basetemp /private/tmp/shifeng-etf-cache-green
    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests -q       --basetemp /private/tmp/shifeng-etf-cache-full

Expected: all tests pass.

- [ ] **Step 6: Commit**

    git add server/etf_monitor/app/main.py       server/etf_monitor/app/service.py       server/etf_monitor/tests/test_api.py       server/etf_monitor/tests/test_service.py
    git commit -m "feat: expose cached ETF monitor snapshots"

---

### Task 3: Resolve trading days and market phases

**Files:**
- Create: server/etf_monitor/app/trading_calendar.py
- Create: server/etf_monitor/tests/test_trading_calendar.py
- Modify: server/etf_monitor/app/config.py
- Test: server/etf_monitor/tests/test_config.py

**Interfaces:**
- Consumes: Settings.timezone and the pinned AkShare dependency.
- Produces: TradingDayResolution, SessionDecision, TradingDayCalendar.resolve(), and market_session_at().

- [ ] **Step 1: Write settings and boundary tests**

    def test_default_schedule_uses_a_share_sessions(tmp_path):
        settings = Settings(db_path=tmp_path / "monitor.db")
        assert settings.morning_open_time == time(9, 30)
        assert settings.morning_close_time == time(11, 30)
        assert settings.afternoon_open_time == time(13, 0)
        assert settings.afternoon_close_time == time(15, 0)
        assert settings.trading_calendar_path == Path(
            "server/data/etf-monitor/trading_calendar.json"
        )

    @pytest.mark.parametrize(
        ("value", "phase", "should_poll"),
        [
            ("2026-09-01T09:29:59+08:00", "pre_open", False),
            ("2026-09-01T09:30:00+08:00", "morning_session", True),
            ("2026-09-01T11:30:00+08:00", "lunch_break", False),
            ("2026-09-01T13:00:00+08:00", "afternoon_session", True),
            ("2026-09-01T15:00:00+08:00", "post_close", False),
        ],
    )
    def test_market_session_boundaries(value, phase, should_poll):
        resolution = TradingDayResolution(True, "confirmed")
        decision = market_session_at(
            datetime.fromisoformat(value),
            resolution,
        )
        assert decision.phase == phase
        assert decision.should_poll is should_poll

    def test_closed_day_never_polls():
        resolution = TradingDayResolution(False, "confirmed")
        decision = market_session_at(
            datetime.fromisoformat(
                "2026-09-05T10:00:00+08:00"
            ),
            resolution,
        )
        assert decision.phase == "closed_day"
        assert decision.should_poll is False

- [ ] **Step 2: Write cache and fallback tests**

    class StaticProvider:
        def __init__(self, days=None, error=None):
            self.days = set(days or [])
            self.error = error
            self.calls = 0

        def fetch_trading_days(self) -> set[date]:
            self.calls += 1
            if self.error:
                raise self.error
            return self.days

    def test_calendar_persists_open_and_closed_days(tmp_path):
        provider = StaticProvider({
            date(2026, 9, 1),
            date(2026, 9, 2),
        })
        calendar = TradingDayCalendar(
            tmp_path / "calendar.json",
            provider,
        )
        assert calendar.resolve(
            date(2026, 9, 1)
        ).is_trading_day is True
        assert calendar.resolve(
            date(2026, 9, 5)
        ).is_trading_day is False
        assert provider.calls == 1

    def test_calendar_uses_cache_when_refresh_fails(tmp_path):
        path = tmp_path / "calendar.json"
        TradingDayCalendar(
            path,
            StaticProvider({date(2026, 9, 1)}),
        ).refresh()
        resolution = TradingDayCalendar(
            path,
            StaticProvider(error=RuntimeError("offline")),
        ).resolve(date(2026, 9, 1), force_refresh=True)
        assert resolution == TradingDayResolution(
            True,
            "cached",
            "offline",
        )

    def test_calendar_without_cache_uses_weekday_fallback(tmp_path):
        resolution = TradingDayCalendar(
            tmp_path / "missing.json",
            StaticProvider(error=RuntimeError("offline")),
        ).resolve(date(2026, 9, 1))
        assert resolution == TradingDayResolution(
            True,
            "weekday_fallback",
            "offline",
        )

- [ ] **Step 3: Verify red**

    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests/test_config.py       server/etf_monitor/tests/test_trading_calendar.py -q       --basetemp /private/tmp/shifeng-etf-calendar-red

Expected: schedule settings and trading_calendar.py are missing.

- [ ] **Step 4: Implement public types and boundaries**

    CalendarQuality = Literal[
        "confirmed",
        "cached",
        "weekday_fallback",
    ]
    MarketPhase = Literal[
        "pre_open",
        "morning_session",
        "lunch_break",
        "afternoon_session",
        "post_close",
        "closed_day",
    ]

    @dataclass(frozen=True)
    class TradingDayResolution:
        is_trading_day: bool
        quality: CalendarQuality
        error: str | None = None

    @dataclass(frozen=True)
    class SessionDecision:
        phase: MarketPhase
        should_poll: bool
        calendar_quality: CalendarQuality
        calendar_error: str | None = None

market_session_at(now, trading_day, schedule values) uses start-inclusive/end-exclusive boundaries.

- [ ] **Step 5: Implement atomic calendar caching**

AkShareTradingDayProvider.fetch_trading_days() lazily imports AkShare and converts tool_trade_date_hist_sina()["trade_date"] into set[date].

TradingDayCalendar writes JSON to a sibling temporary file and atomically replaces the target. JSON fields are updated_at, covered_years, and sorted trading_days. A missing weekday is confirmed closed only when its year appears in covered_years.

Fallback logic:

    if day.weekday() >= 5:
        return TradingDayResolution(False, quality, error)
    if cached_snapshot_covers(day.year):
        return TradingDayResolution(
            day in cached_days,
            quality,
            error,
        )
    return TradingDayResolution(
        True,
        "weekday_fallback",
        error,
    )

- [ ] **Step 6: Verify green and commit**

    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests/test_config.py       server/etf_monitor/tests/test_trading_calendar.py -q       --basetemp /private/tmp/shifeng-etf-calendar-green
    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests -q       --basetemp /private/tmp/shifeng-etf-calendar-full
    git add server/etf_monitor/app/config.py       server/etf_monitor/app/trading_calendar.py       server/etf_monitor/tests/test_config.py       server/etf_monitor/tests/test_trading_calendar.py
    git commit -m "feat: resolve ETF monitor trading sessions"

---

### Task 4: Gate and expose the background scheduler

**Files:**
- Modify: server/etf_monitor/app/scheduler.py
- Modify: server/etf_monitor/app/main.py
- Modify: server/etf_monitor/app/models.py
- Create: server/etf_monitor/tests/test_scheduler.py
- Modify: server/etf_monitor/tests/test_api.py

**Interfaces:**
- Consumes: TradingDayCalendar.resolve(), market_session_at(), and MonitorService.poll_all().
- Produces: PollScheduler.run_once(), PollScheduler.status(), session-gated polling, and enriched health.

- [ ] **Step 1: Write scheduler tests with injected time**

Define the complete local harness in test_scheduler.py before the tests:

    class RecordingService:
        def __init__(self):
            self.poll_count = 0

        def poll_all(self):
            self.poll_count += 1
            return [
                PollResponse(
                    symbol="159915.SZ",
                    data_status="live",
                    candle_count=1,
                    alert=None,
                )
            ]

    class StaticCalendar:
        def __init__(self, resolution):
            self.resolution = resolution

        def resolve(self, day, force_refresh=False):
            return self.resolution

    def scheduler_at(value: str, service: RecordingService):
        current = datetime.fromisoformat(value)
        is_weekday = current.weekday() < 5
        return PollScheduler(
            service=service,
            interval_seconds=60,
            calendar=StaticCalendar(
                TradingDayResolution(is_weekday, "confirmed")
            ),
            now=lambda: current,
            completion_delay_seconds=60,
        )

    def test_scheduler_polls_immediately_in_morning():
        service = RecordingService()
        scheduler = scheduler_at(
            "2026-09-01T10:00:00+08:00",
            service,
        )
        scheduler.run_once()
        assert service.poll_count == 1
        assert scheduler.status().phase == "morning_session"
        assert scheduler.status().monitoring_active is True

    @pytest.mark.parametrize(
        "value",
        [
            "2026-09-01T12:00:00+08:00",
            "2026-09-01T16:00:00+08:00",
            "2026-09-05T10:00:00+08:00",
        ],
    )
    def test_scheduler_does_not_poll_outside_session(value):
        service = RecordingService()
        scheduler_at(value, service).run_once()
        assert service.poll_count == 0

    def test_scheduler_finalizes_once_after_close_delay():
        service = RecordingService()
        scheduler = scheduler_at(
            "2026-09-01T15:01:00+08:00",
            service,
        )
        scheduler.run_once()
        scheduler.run_once()
        assert service.poll_count == 1
        assert scheduler.status().phase == "post_close"

The single post-close call ingests the completed 15:00 bar and runs the existing once-per-day summary; it is not periodic polling.

- [ ] **Step 2: Write health tests**

Use the existing FakeMarketData test double already defined in test_api.py; do not introduce a second incompatible client contract.

    def test_health_exposes_scheduler_state(tmp_path):
        app = create_app(
            db_path=tmp_path / "monitor.db",
            market_data_client=FakeMarketData([]),
            scheduler_enabled=False,
        )
        with TestClient(app) as client:
            body = client.get("/api/health").json()

        assert isinstance(
            body["scheduler"]["monitoring_active"],
            bool,
        )
        assert "phase" in body["scheduler"]
        assert "calendar_quality" in body["scheduler"]
        assert "last_poll_attempt" in body["scheduler"]
        assert "last_poll_success" in body["scheduler"]

- [ ] **Step 3: Verify red**

    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests/test_scheduler.py       server/etf_monitor/tests/test_api.py -q       --basetemp /private/tmp/shifeng-etf-scheduler-red

Expected: run_once, status, and nested scheduler health are missing.

- [ ] **Step 4: Implement status and loop**

Add SchedulerStatus fields: phase, monitoring_active, calendar_quality, calendar_error, last_poll_attempt, and last_poll_success.

PollScheduler accepts injected now, calendar, and stop_event. Protect mutable status and finalized_dates with a lock. run_once():

1. Resolves the Shanghai day and phase.
2. Calls poll_all() when should_poll is true.
3. Calls poll_all() once after 15:00 plus candle completion delay for each trading date.
4. Records attempt before the call.
5. Records success only when at least one PollResponse has no error.
6. Preserves phase and calendar errors when polling fails.

The thread loop uses stop_event.wait(seconds), not sleep(). Active waits use poll_interval_seconds; idle waits are capped at 60 seconds.

- [ ] **Step 5: Wire lifecycle and health**

Construct TradingDayCalendar from Settings.trading_calendar_path. Attach monitor_service and poll_scheduler to app.state. Health includes scheduler.status(). Process health stays HTTP 200 while cache routes function, even if data is cached, empty, or the calendar uses explicit fallback.

- [ ] **Step 6: Verify green and commit**

    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests/test_scheduler.py       server/etf_monitor/tests/test_api.py -q       --basetemp /private/tmp/shifeng-etf-scheduler-green
    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests -q       --basetemp /private/tmp/shifeng-etf-scheduler-full
    git add server/etf_monitor/app/main.py       server/etf_monitor/app/models.py       server/etf_monitor/app/scheduler.py       server/etf_monitor/tests/test_api.py       server/etf_monitor/tests/test_scheduler.py
    git commit -m "feat: poll ETFs only during trading sessions"

---

### Task 5: Align Express and display monitoring state

**Files:**
- Modify: server/api/etf_monitor.js
- Modify: server/api/etf_monitor.test.js
- Create: src/pages/TMTMargin/etfMonitorState.ts
- Modify: src/pages/TMTMargin/ETFMonitorPanel.tsx
- Create: tests/etfMonitorState.test.ts

**Interfaces:**
- Consumes: cached-snapshot and scheduler health.
- Produces: overview schedule metadata and user-facing automatic-monitoring copy.

- [ ] **Step 1: Add failing Express assertions**

Health stub includes phase, monitoring_active, calendar_quality, calendar_error, last_poll_attempt, and last_poll_success. Assert the overview copies those fields and only calls cached-snapshot.

Add a mixed-result test where one cached snapshot succeeds and one throws. Expect HTTP 200, the successful item retained, the failed item degraded, and success true.

- [ ] **Step 2: Verify red**

    node --test server/api/etf_monitor.test.js

Expected: schedule metadata is absent.

- [ ] **Step 3: Add exact overview fields**

    market_phase:
      health?.scheduler?.phase || 'unknown',
    monitoring_active:
      Boolean(health?.scheduler?.monitoring_active),
    calendar_quality:
      health?.scheduler?.calendar_quality || 'unknown',
    calendar_error:
      health?.scheduler?.calendar_error || null,
    last_poll_attempt:
      health?.scheduler?.last_poll_attempt || null,
    last_poll_success:
      health?.scheduler?.last_poll_success || null,

Keep per-symbol error isolation. Health status ok is not proof that data is live.

- [ ] **Step 4: Write failing UI mapping tests**

    test('active session reports automatic monitoring', () => {
      assert.deepEqual(
        etfMonitoringCopy(
          'morning_session',
          true,
          'confirmed',
        ),
        {
          label: '自动监控中',
          tone: 'success',
          detail: '',
        },
      );
    });

    test('lunch and close explain pause', () => {
      assert.equal(
        etfMonitoringCopy(
          'lunch_break',
          false,
          'confirmed',
        ).label,
        '午休暂停',
      );
      assert.equal(
        etfMonitoringCopy(
          'post_close',
          false,
          'confirmed',
        ).label,
        '已收盘',
      );
    });

    test('calendar fallback is visible', () => {
      assert.equal(
        etfMonitoringCopy(
          'morning_session',
          true,
          'weekday_fallback',
        ).detail,
        '交易日日历降级为工作日判断',
      );
    });

- [ ] **Step 5: Verify UI red**

    node --test --experimental-strip-types       tests/etfMonitorState.test.ts

Expected: etfMonitorState.ts is missing.

- [ ] **Step 6: Implement and render the mapping**

Labels: morning/afternoon 自动监控中, pre-open 等待开盘, lunch 午休暂停, post-close 已收盘, closed-day 今日休市, unknown 调度状态未知.

Extend EtfOverview fields. Render a second tag beside data status. Show last_poll_success in the update row and calendar fallback as a compact warning without hiding item errors.

- [ ] **Step 7: Verify and commit**

    node --test server/api/etf_monitor.test.js
    node --test --experimental-strip-types       tests/etfMonitorState.test.ts
    npm run build
    git add server/api/etf_monitor.js       server/api/etf_monitor.test.js       src/pages/TMTMargin/ETFMonitorPanel.tsx       src/pages/TMTMargin/etfMonitorState.ts       tests/etfMonitorState.test.ts
    git commit -m "feat: surface ETF automatic monitoring state"

---

### Task 6: Supervise Python from the normal local entrypoint

**Files:**
- Create: server/lib/etfMonitorProcess.js
- Create: server/lib/etfMonitorProcess.test.js
- Modify: server/lib/pythonRuntime.js
- Modify: server/lib/pythonRuntime.test.js
- Modify: index.js
- Modify: scripts/cloudflare-tunnel.sh
- Modify: scripts/tunnel.env.example
- Modify: server/startup.test.js

**Interfaces:**
- Consumes: repository service path and project Python runtime.
- Produces: createEtfMonitorSupervisor(), start(), stop(), restart, and ETF_MONITOR_URL injection.

- [ ] **Step 1: Add runtime expectation**

In pythonRuntime.test.js:

    assert.equal(env.ETF_MONITOR_PYTHON, pythonBin);

In configureProjectPythonRuntime():

    env.ETF_MONITOR_PYTHON ||= pythonBin;

- [ ] **Step 2: Write supervisor tests with fakes**

Build the harness from Node EventEmitter. fakeSpawn(calls) creates an EventEmitter child with kill(signal) setting child.killed and emitting exit. sequenceProbe(values) shifts Boolean values and returns the last value after exhaustion. restartHarness() stores children, captures the scheduled restart callback, and exposes runScheduledRestart() to execute it synchronously.

Test four cases: start repository Uvicorn with port 8123, reuse healthy configured upstream, restart an unexpectedly exited child, and stop without restart. Each test constructs all fakes through those three helpers; no real process, timer, or network call is allowed.

Expected spawn arguments:

    [
      '-m', 'uvicorn', 'app.main:app',
      '--app-dir', '/repo/server/etf_monitor',
      '--host', '127.0.0.1',
      '--port', '8123',
    ]

- [ ] **Step 3: Verify red**

    node --test server/lib/pythonRuntime.test.js       server/lib/etfMonitorProcess.test.js

Expected: runtime variable and supervisor are missing.

- [ ] **Step 4: Implement supervisor behavior**

Defaults:

- Disabled only by ETF_MONITOR_ENABLED=0 or DISABLE_BACKGROUND_JOBS=1.
- URL is http://127.0.0.1 at ETF_MONITOR_PORT, default 8000.
- Python order is ETF_MONITOR_PYTHON, SHIFENG_PYTHON_BIN, PYTHON, python3.
- App dir is projectRoot/server/etf_monitor.
- Health path is /api/health.
- Startup timeout is 45 seconds.
- Unexpected managed-child restart delay is 5 seconds.

start() is idempotent. stop() disables restarts before SIGTERM. Logs omit environment values. Startup failure is logged and Express may continue degraded.

- [ ] **Step 5: Wire root index lifecycle**

Call configureProjectPythonRuntime(), create the supervisor, await start with concise error handling, install SIGINT/SIGTERM cleanup, then import server/index.js. Signal handling must not recurse.

- [ ] **Step 6: Remove duplicate tunnel ownership**

Delete ETF_MONITOR_DIR, ETF child/watch PIDs, start_etf_monitor(), and watch_etf_monitor() from cloudflare-tunnel.sh. Keep:

    ETF_MONITOR_ENABLED="${ETF_MONITOR_ENABLED:-1}"
    ETF_MONITOR_PORT="${ETF_MONITOR_PORT:-8000}"
    ETF_MONITOR_URL="${ETF_MONITOR_URL:-http://127.0.0.1:${ETF_MONITOR_PORT}}"

Remove ETF_MONITOR_DIR from tunnel.env.example and document ETF_MONITOR_PYTHON.

- [ ] **Step 7: Verify and commit**

    node --test server/lib/pythonRuntime.test.js       server/lib/etfMonitorProcess.test.js       server/startup.test.js
    git add index.js scripts/cloudflare-tunnel.sh       scripts/tunnel.env.example       server/lib/etfMonitorProcess.js       server/lib/etfMonitorProcess.test.js       server/lib/pythonRuntime.js       server/lib/pythonRuntime.test.js       server/startup.test.js
    git commit -m "feat: supervise ETF monitor with local server"

---

### Task 7: Add container deployment and docs

**Files:**
- Create: server/etf_monitor/Dockerfile
- Modify: docker-compose.yml
- Modify: README.md
- Modify: .gitignore

**Interfaces:**
- Consumes: FastAPI entrypoint and Express ETF_MONITOR_URL.
- Produces: etf-monitor Compose service, etf-monitor-data volume, and operating instructions.

- [ ] **Step 1: Add Python Dockerfile**

Use python:3.12-slim, install requirements.txt, copy app, create /data, set DB_PATH and TRADING_CALENDAR_PATH, expose 8000, add a standard-library urllib healthcheck, and run Uvicorn app.main:app.

- [ ] **Step 2: Wire Compose**

Add etf-monitor with restart unless-stopped and named volume etf-monitor-data at /data. Set API ETF_MONITOR_URL=http://etf-monitor:8000 and depend on ETF health. Keep existing services and public ports.

- [ ] **Step 3: Validate**

    docker compose config

Expected: ETF service, internal URL, health dependency, and volume resolve. If Docker exists:

    docker build -f server/etf_monitor/Dockerfile       -t shifeng-etf-monitor:test .

Expected: image builds.

- [ ] **Step 4: Document operation**

README commands:

    server/data/python-venv/bin/python3 -m pip install       -r server/etf_monitor/requirements-dev.txt
    npm run server
    curl http://127.0.0.1:3000/api/etf-monitor/health
    curl http://127.0.0.1:3000/api/etf-monitor/overview

Document session windows, manual refresh, persistent paths, Docker volume, and removal of the Downloads runtime dependency.

- [ ] **Step 5: Commit**

    git add .gitignore README.md docker-compose.yml       server/etf_monitor/Dockerfile
    git commit -m "build: deploy ETF monitor with the platform"

---

### Task 8: Migrate history and verify end to end

**Files:**
- Runtime only: server/data/etf-monitor/etf_monitor.db
- Runtime only: server/data/etf-monitor/trading_calendar.json
- Verify: all Task 1–7 files

**Interfaces:**
- Consumes: reference database and completed integration.
- Produces: working local overview with history and verification evidence.

- [ ] **Step 1: Inspect DB targets**

    ls -lh '/Users/ray_wang/Downloads/汇总代码库/3: etf_monitor/backend/data/etf_monitor.db'
    ls -lh server/data/etf-monitor/etf_monitor.db       2>/dev/null || true

If destination exists, compare row counts and timestamps. Never overwrite when both contain unique newer data.

- [ ] **Step 2: Seed only an absent destination**

    mkdir -p server/data/etf-monitor
    cp '/Users/ray_wang/Downloads/汇总代码库/3: etf_monitor/backend/data/etf_monitor.db'       server/data/etf-monitor/etf_monitor.db

Confirm git status does not show the DB.

- [ ] **Step 3: Run automated verification**

    server/data/python-venv/bin/python3 -m pytest       server/etf_monitor/tests -q       --basetemp /private/tmp/shifeng-etf-final-pytest
    node --test server/api/etf_monitor.test.js       server/lib/etfMonitorProcess.test.js       server/lib/pythonRuntime.test.js       server/startup.test.js
    node --test --experimental-strip-types       tests/etfMonitorState.test.ts
    npm run build

Expected: all commands pass.

- [ ] **Step 4: Verify Python APIs using a DB copy**

Start Uvicorn on 18000 with DB_PATH=/private/tmp/shifeng-etf-monitor-verification.db, TRADING_CALENDAR_PATH=/private/tmp/shifeng-etf-calendar.json, and SCHEDULER_ENABLED=false. Request health, symbols, and cached-snapshot for 159915.SZ.

Expected: scheduler health exists, symbols are non-empty, and cached data returns without live fetch.

- [ ] **Step 5: Verify platform aggregation**

Start Node on 3100 with ETF_MONITOR_URL=http://127.0.0.1:18000 and DISABLE_BACKGROUND_JOBS=1. Request /api/etf-monitor/health and /api/etf-monitor/overview.

Expected: HTTP 200 overview, non-empty items, cached state, and scheduler metadata.

- [ ] **Step 6: Verify transitions without changing clock**

Run injected tests for 09:29, 09:30, 11:30, 13:00, 15:00, 15:01, weekend, holiday, calendar failure, and weekday fallback.

- [ ] **Step 7: Inspect scope**

    git diff --check
    git status --short
    git log --oneline -10

Expected: no ETF commit contains secrets, DB, calendar cache, venv, logs, reference temporary files, or unrelated changes.

- [ ] **Step 8: Commit only tracked verification corrections**

If verification required a tracked ETF correction, rerun the exact failing command, stage only the correction, and commit with message test: verify ETF monitor integration. If no correction was needed, do not create an empty commit.
