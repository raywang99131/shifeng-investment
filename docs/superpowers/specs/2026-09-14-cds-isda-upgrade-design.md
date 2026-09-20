# CDS ISDA parallel upgrade

User approved upgrading the pricing implementation after reviewing the calibration experiment. The approved rollout is parallel comparison before replacement of the official displayed series. No screenshot-fitted offsets enter production pricing.

Add an isolated QuantLib 1.43 Python batch pricer using IsdaCdsEngine, NYM calendar, full accrual and cash settlement treatment. Node invokes it without a shell, with bounded input/output/time, and records its version. A published Markit/QuantLib benchmark plus date/convention and malformed-input cases gate use.

Keep the legacy workbook and headline series unchanged. On every successful ICE import, reprice the archived actual ICE rows into creditRisk.cdsModelComparison. Skip screenshot history, preserve contract identity, calculate changes only within the new series and the same curve regime. Persist the comparison in the existing atomic snapshot transaction. A failed parallel run reports failure and last-success date; it must neither overwrite the headline series nor make old comparisons appear current. Add a manual comparison-only refresh using the existing snapshot writer lock.

Allow a local standard-curve JSON file through ICE_CDS_STANDARD_CURVES_FILE. Its curves have curveId, asOf (valuation date), marketDataAsOf, currency USD, sourceKind isda-standard-rfr, sourceUrl, and discountFactors [{date,discountFactor}], starting at asOf with 1. Require marketDataAsOf < asOf, a short lag, strictly increasing real dates, positive finite discount factors and matching valuation date. Reject invalid configured input. If no matching standard curve is available, explicitly label the existing archived Treasury nodes as treasury-proxy. Do not claim that declaring provenance or loading a file verifies market quotations. No provider registration or terms acceptance is automated.

Dashboard shows parallel status, date, curve source, old/new/latest difference and old/new week change in a dedicated component. Both results remain model estimates, not official Bloomberg/ICE spreads. No automatic switch is exposed until independent market benchmarks are available.

Install pinned Python dependency in server/data/cds-python-venv, ignored by git. Support ICE_CDS_PYTHON override and documented setup/test/refresh commands. Container runtime must support the published manylinux QuantLib wheel (Debian rather than Alpine). Reuse existing running deployment without disrupting unrelated services; perform build and checks before a targeted backend reload.
