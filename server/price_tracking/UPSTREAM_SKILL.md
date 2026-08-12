# price_total Update Skill

This skill refreshes the project's master price workbook by running every
data-collection script under `scripts/`. A future Agent (human or AI) should be
able to read this file and reproduce the end-to-end refresh without rediscovering
the workflow.

---

## 1. What lives where

```
price_total/
+- price_summarized_optimized.xlsx     # The workbook this skill refreshes.
|                                      # All scripts read/write this single file.
+- price_summarized.xlsx               # Older copy, kept for reference; do not edit.
+- price_summarized_optimized.bak.xlsx # Hand-rolled snapshot (created by you, the runner).
+- price_summarized_optimized.xlsx.bak_YYYYMMDD_HHMMSS
|                                      # Auto snapshots created by --inplace runs.
+- price_summarized_optimized.akshare_update_log.csv
|                                      # Per-item log of the last AKShare run; appended to.
+- scripts/                            # Every data-collection script lives here.
|  +- __init__.py                      # Marks scripts/ as a Python package.
|  +- fetch_r32_price.py               # sci99 R32/TDI/MDI/etc.
|  +- fetch_shpgx_lng.py               # Shanghai LNG trading center.
|  +- fetch_tungsten_prices.py         # CTIA tungsten (black + recycled).
|  +- scrape_brent_oil.py              # TradingEconomics Brent via playwright.
|  +- scrape_hafnium.py                # strategicmetalsinvest.com hafnium.
|  +- scrape_q5500.py                  # cctd.com.cn Q5500/Q5000/Q4500 thermal coal.
|  +- update_akshare_futures.py        # AKShare 7 domestic futures + tungsten (needs --inplace).
|  +- update_btc_eth_cme.py            # Yahoo Finance BTC/ETH + ICE Brent via BZ=F.
|  +- update_co.py                     # 100ppi cobalt benchmark price.
|  +- update_futures_with_comex_silver.py  # Same 7 futures + COMEX silver + tungsten (needs --inplace).
|  +- update_kcl.py                    # 100ppi potassium chloride.
|  +- update_lme_cnal_prices.py        # LME copper + aluminum.
|  +- update_xau_price.py              # London gold spot (huilvbiao.com).
- tests/                              # pytest suite (fetch_r32, tungsten, akshare, cobalt).
+- tests/                              # pytest suite (fetch_r32, tungsten, akshare).
+- docs/                               # Project notes / plans; not consumed by scripts.
+- skill.md                            # This file.
```

The workbook has 32 sheets (mostly Chinese names). Every script targets exactly
one of those sheets, so a successful run means the corresponding sheet's top
row is dated today (or the most recent trade date if today is a holiday/weekend).

## 2. Golden rules

- **Close the workbook in Excel/WPS first.** The Python writers cannot acquire
  an exclusive write lock while the file is open. `fetch_shpgx_lng.py` is the
  only script that handles the locked case gracefully (it stages a copy and
  prints a path); all the others will raise `PermissionError`.
- **Run scripts sequentially.** They all write the same file. Running them in
  parallel would corrupt the workbook.
- **Always start with a snapshot.** Copy the workbook aside before the first run
  of the day so you can recover from a bad write:

  ```powershell
  Copy-Item price_summarized_optimized.xlsx price_summarized_optimized.bak.xlsx
  ```

- **Use `--inplace` for the two AKShare scripts.** Without it they write a new
  `*_akshare.xlsx` file and never touch the master workbook.
- **The workbook path lives in each script.** `WORKBOOK_PATH`,
  `WORKBOOK_FILE`, `TARGET_FILE`, or `DEFAULT_WORKBOOK_FILE` all default to
  `price_summarized_optimized.xlsx` at the project root, resolved as
  `Path(__file__).resolve().parent.parent / "..."`. You almost never need to
  pass a path.


## 3. Standard refresh procedure

All commands assume the current directory is the project root.

### 3.1 Pre-flight

```powershell
# Make sure the workbook is closed in any spreadsheet app, then snapshot it.
Copy-Item price_summarized_optimized.xlsx price_summarized_optimized.bak.xlsx
```

### 3.2 Run the simple scripts (no CLI flags)

Each of these opens the workbook, fetches its single source, and saves. They
print a one-line summary that includes the trade date.

```powershell
python scripts\update_xau_price.py
python scripts\fetch_tungsten_prices.py                # See note below.
python scripts\update_btc_eth_cme.py
python scripts\fetch_r32_price.py
python scripts\fetch_shpgx_lng.py
python scripts\scrape_q5500.py
python scripts\update_kcl.py
python scripts\update_co.py
python scripts\update_lme_cnal_prices.py
python scripts\scrape_hafnium.py
python scripts\scrape_brent_oil.py
```

> Note on tungsten. CTIA publishes news articles on most business days but not
> every day. If `fetch_tungsten_prices.py` errors with
> `No CTIA tungsten news articles were found for YYYY-MM-DD.`, pick the most
> recent trade date (often Friday) and re-run with `--date`:
>
> ```powershell
> python scripts\fetch_tungsten_prices.py --date 2026-07-10
> ```
>
> This writes the trade date 2026-07-10 into the tungsten sheets even when run
> today. The two AKShare scripts below also try to refresh the tungsten sheets
> and will hit the same error; treat their failure as expected on article-less
> days.

### 3.3 Run the AKShare scripts (require `--inplace`)

These two scripts rewrite the workbook in place after auto-snapshotting the
original to `*.bak_YYYYMMDD_HHMMSS`. Run them **one at a time** so the
snapshots don't clobber each other.

```powershell
python scripts\update_akshare_futures.py             --input price_summarized_optimized.xlsx --inplace
python scripts\update_futures_with_comex_silver.py  --input price_summarized_optimized.xlsx --inplace
```

Each prints a per-sheet summary plus a CSV log alongside the workbook. Both
fetch the 7 domestic futures (urea / rebar / coking coal / alumina / lithium
carbonate / coke / polysilicon); `update_futures_with_comex_silver.py`
additionally fetches COMEX silver. The CTIA tungsten step at the end will fail
on article-less days; the 7/8 (or 8/9) successful commodity updates are still
saved.

### 3.4 Verify

Open `price_summarized_optimized.xlsx` and confirm the top row of every sheet
is dated today (or the most recent trade date). The script below dumps the top
row of each sheet for a quick sanity check:

```powershell
python -c "from openpyxl import load_workbook; \
wb = load_workbook('price_summarized_optimized.xlsx', read_only=True, data_only=True); \
[print(name, next((r for r in wb[name].iter_rows(min_row=3, values_only=True) if r and r[0]), None)) \
 for name in wb.sheetnames]"
```

For a deeper check, open `price_summarized_optimized.akshare_update_log.csv` to
see the per-item AKShare results.

### 3.5 Test the suite

```powershell
python -m pytest tests\ -q
```

Nine tests should pass. They exercise `fetch_r32_price`, `fetch_tungsten_prices`,
Fifteen tests should pass. They exercise `fetch_r32_price`, `fetch_tungsten_prices`,
`update_akshare_futures`, and `update_co` without touching the network.


## 4. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `PermissionError: [Errno 13] Permission denied: '...\\price_summarized_optimized.xlsx'` | Excel/WPS has the file open | Close the file and rerun the failed script. |
| `fetch_shpgx_lng.py` prints `Next step: ... --commit <staged.xlsx>` | Workbook was locked when the script ran | Close Excel, then run `Move-Item price_summarized_optimized.staged.xlsx price_summarized_optimized.xlsx -Force` to swap in the staged copy. |
| `ValueError: No CTIA tungsten news articles were found for YYYY-MM-DD.` | CTIA did not publish today | Rerun with `--date YYYY-MM-DD` for the most recent published date. |
| `ModuleNotFoundError: No module named 'playwright'` (raised by `scrape_brent_oil.py`) | Playwright runtime not installed | `pip install playwright && python -m playwright install chromium`. |
| AKShare scripts end with `ERROR [失败] CTIA tungsten: ...` | Same as the tungsten note above | Treat as expected on article-less days; the 7/8 (or 8/9) commodity updates are already saved. |
| `openpyxl` raises `FileFormatError` when loading | Someone saved a non-Excel format over the file | Restore from `price_summarized_optimized.bak.xlsx` and re-run. |
| `requests.exceptions.SSLError` / connection timeouts | Source site is rate-limiting or down | Wait and retry. The scripts have no built-in retry; if the failure persists, drop that sheet from this refresh and try again tomorrow. |

## 5. Sheet -> Script map

For quick reference, here is which script owns which sheet (sheet names are
the Chinese labels openpyxl reports, which may render as `?` in non-Unicode
terminals):

| Sheet (display) | Sheet (canonical) | Owner |
|---|---|---|
| London gold spot | 伦敦金现 | `update_xau_price.py` |
| BTC.CME | BTC.CME | `update_btc_eth_cme.py` |
| ETH.CME | ETH.CME | `update_btc_eth_cme.py` |
| ICE Brent | ICE布油 | `update_btc_eth_cme.py` |
| Refrigerant R32 / TDI / MDI / polymeric MDI / pure MDI | see `PRODUCTS` in `fetch_r32_price.py` | `fetch_r32_price.py` |
| LNG | 液化天然气 | `fetch_shpgx_lng.py` |
| Q5500 thermal coal | Q5500动力煤 | `scrape_q5500.py` |
| Potassium chloride | 氯化钾 | `update_kcl.py` |
| Cobalt | 钴 | `update_co.py` |
| LME copper / LME aluminum | LME铜 / LME铝 | `update_lme_cnal_prices.py` |
| Hafnium | 铪 | `scrape_hafnium.py` |
| Crude oil | 原油 | `scrape_brent_oil.py` |
| Urea / rebar / coking coal / alumina / lithium carbonate / coke / polysilicon | see `FUTURES_MAP` in `update_akshare_futures.py` | `update_akshare_futures.py`, `update_futures_with_comex_silver.py` |
| COMEX silver | COMEX白银 | `update_futures_with_comex_silver.py` |
| Black tungsten / recycled tungsten bar | 黑钨精矿 / 废钨棒材 | `fetch_tungsten_prices.py`, `update_akshare_futures.py`, `update_futures_with_comex_silver.py` |

Sheets that show up in the workbook but are **not** refreshed by any script
(e.g. `总表`, `尿素`, `国产三元复合肥`, `海绵锆`, `铬`, `锡`) are populated
manually or by sources that are no longer wired up. Leave them alone.

## 6. When you change a script

If you edit one of the scripts in `scripts/`:

1. Run `python -m pytest tests\ -q` to confirm the existing tests still pass.
2. Add or update a test in `tests/` to cover the new behavior. The `tests/`
   directory already has `conftest.py` which puts the project root on
   `sys.path` so tests can `from scripts.<name> import ...` cleanly.
3. Update the sheet->script map in section 5 if the script's responsibilities
   changed.
4. Re-run section 3 against a snapshot to confirm nothing regressed.

If you add a new script:

1. Put it under `scripts/`.
2. Default its workbook constant to
   `Path(__file__).resolve().parent.parent / "price_summarized_optimized.xlsx"`.
3. If it imports other scripts in `scripts/`, copy the `sys.path` bootstrap at
   the top of `update_akshare_futures.py` so the cross-import works whether
   the script is run as `python scripts/<name>.py` or imported as
   `scripts.<name>` by the test suite.
4. Update section 5 with the new script and which sheet it owns.
