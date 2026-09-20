# CDS ISDA Upgrade Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for the independent pricing task; integrate and review in this session.

**Goal:** Install and run a standard CDS engine alongside the existing production series with honest curve provenance.
**Architecture:** Python batch pricing, Node comparison service, atomic snapshot integration, dedicated React comparison view.
**Tech Stack:** QuantLib 1.43, Python 3.9+, existing Node/React/Ant Design.
**Spec:** docs/superpowers/specs/2026-09-14-cds-isda-upgrade-design.md

## Global constraints

- Parallel rollout; no replacement of the headline series and no screenshot calibration.
- Preserve existing dirty work in this codex/ai-dashboard workspace.
- Standard curve availability is not assumed; fallback is explicitly treasury-proxy.
- Financial output must have source, date and model provenance; failures are visible.

## Tasks

- [x] Pricing engine: server/cds_pricing/{pricer.py,test_pricer.py,requirements.txt,NYM.csv}. Input schemaVersion 1, records [{id,clearingDate,maturityDate,cleanPrice,couponBp,recoveryRate,discountCurve}]. Curve supports archived nodes [{years,zeroRate}] or dated discountFactors. Output schemaVersion 1, engine/version/modelVersion and rows [{id,spreadBp,roundTripPrice,priceResidual,curveId,curveAsOf,stepInDate,cashSettlementDate,accrualRebatePer100,modelVersion}]. First run tests showing missing implementation; verify independent published benchmark and invalid dates/numbers, Friday/weekend and coupon-date handling. `python -m unittest discover -s server/cds_pricing -v`.
- [x] Node bridge and comparison: server/lib/{isdaCdsEngine,iceCdsComparison}.js and tests. Bridge signature priceBatch(records); builder signature buildComparison(state,{generatedAt,previous}). Read frozen archive, compare aligned actual observations, enforce response id/finite/residual constraints. Tests cover wrong/missing/duplicate responses, invalid curves, absent official curves, no screenshot repricing, errors and regime boundaries.
- [x] Persistence: inject comparison builder into createIceCdsPipelineFromEnv; add comparison-only refresh method and script. Tests verify old series/workbook preservation and atomic snapshot locking while keeping other dashboard slices.
- [x] UI: new CdsModelComparisonPanel.tsx plus types and one insertion into AIDashboardSections.tsx. Table contains both model levels and week changes, status/error and source disclosure; no stale value presented as current. Build/type checks and rendered verification.
- [x] Runtime: install pinned QuantLib in project data venv; add setup/test/refresh commands and Docker runtime dependency; document standard-curve format and source limitations. Run focused Node/Python tests, production build, real archive repricing and API checks, then targeted local reload. Final independent review of all changes.

Ruling: user already approved the implementation direction; proceed without another design approval. Standard curves need external authorized data, so finish the adapter and label the proxy honestly instead of fitting or fabricating curves.

## Verification evidence

Completed 2026-09-14. See `reports/cds-upgrade-2026-09-14/README.md` and JSON/browser evidence. 84 Node tests, 10 Python tests, production build, 98 actual archive observations and targeted service reload passed. No Docker executable is available; container image build is unverified. Standard RFR market input remains externally required before promoting the parallel series.
