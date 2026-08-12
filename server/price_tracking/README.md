# Price tracking

This directory is the project-local replacement for `/Users/rayw/Downloads/price_total`.
The application must not read the Downloads copy at runtime.

## Contents

- `price_summarized_optimized.xlsx`: migrated historical master workbook.
- `scripts/`: upstream collectors, kept project-local so the original folder can be deleted.
- `requirements.txt`: Python packages required by the collectors.
- `UPSTREAM_SKILL.md`: original refresh notes retained for auditability.

## Runtime flow

1. `server/scripts/refresh_price_tracking.py` runs collectors sequentially.
2. `server/scripts/export_price_tracking.py` normalizes every non-summary worksheet.
3. The normalized cache is written to `server/data/price-tracking/cache.json`.
4. `server/lib/priceTracking.js` serves the cache immediately and schedules a background refresh every 30 minutes.

The news refresh endpoint only starts the background price refresh. It does not wait for slow price sources.
