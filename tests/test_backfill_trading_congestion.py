import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts/backfill_trading_congestion_eastmoney.py"
SPEC = importlib.util.spec_from_file_location("backfill_trading_congestion_eastmoney", SCRIPT_PATH)
congestion = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(congestion)

TMT_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "macd screener/tmt_margin.py"
TMT_SPEC = importlib.util.spec_from_file_location("tmt_margin", TMT_SCRIPT_PATH)
tmt_margin = importlib.util.module_from_spec(TMT_SPEC)
TMT_SPEC.loader.exec_module(tmt_margin)


class HistoricalSnapshotTest(unittest.TestCase):
    def test_legacy_cached_sources_are_accepted_by_both_refresh_paths(self):
        valid_legacy_rows = [
            {
                "date": "20120104",
                "source": "tushare_daily_fallback",
                "top1_ratio": 12.3,
            },
            {
                "date": "20120105",
                "top1_ratio": 12.4,
                "top3_ratio": 20.1,
            },
            {
                "code": "600000",
                "name": "浦发银行",
                "amount": 1_000_000,
            },
        ]
        invalid_rows = [
            {},
            {"date": "20120104"},
            {"code": "600000"},
            {"source": "unknown_source", "date": "20120104", "top1_ratio": 12.3},
        ]

        for row in valid_legacy_rows:
            self.assertTrue(tmt_margin._is_eastmoney_trading_source(row), row)
            self.assertTrue(congestion.is_eastmoney_row(row), row)
        for row in invalid_rows:
            self.assertFalse(tmt_margin._is_eastmoney_trading_source(row), row)
            self.assertFalse(congestion.is_eastmoney_row(row), row)

        source_less_top100 = {
            "20120104": [{"code": "600000", "name": "浦发银行", "amount": 1_000_000}]
        }
        self.assertEqual(
            tmt_margin._filter_eastmoney_top100_cache(source_less_top100),
            source_less_top100,
        )
        self.assertEqual(
            congestion.filter_eastmoney_top100(source_less_top100),
            source_less_top100,
        )

    def test_normalize_code_handles_baostock_market_prefixes(self):
        self.assertEqual(congestion.normalize_code("sh.600000"), "600000")
        self.assertEqual(congestion.normalize_code("sz.000001"), "000001")
        self.assertEqual(congestion.normalize_code("bj.430001"), "430001")

    def test_strict_a_share_filter_excludes_indices_and_funds(self):
        accepted = [
            "sh.600000", "sh.688001", "sz.000001", "sz.300001", "bj.430001"
        ]
        rejected = [
            "sh.000001", "sz.399998", "sh.510300", "sz.159915", "us.AAPL", ""
        ]
        self.assertTrue(all(congestion.is_strict_a_share_code(code) for code in accepted))
        self.assertTrue(all(not congestion.is_strict_a_share_code(code) for code in rejected))

    def test_historical_snapshot_builds_spot_contract_and_converts_volume(self):
        row, top100, volume_top100 = congestion.build_historical_trading_snapshot(
            "20260720",
            [
                {
                    "code": "600000",
                    "name": "浦发银行",
                    "close": 12.34,
                    "pct_chg": 1.2,
                    "volume": 12_340_000,
                    "amount": 1_000_000_000,
                    "turnover_rate": 2.3,
                },
                {
                    "code": "000001",
                    "name": "平安银行",
                    "close": 10,
                    "pct_chg": -0.5,
                    "volume": 8_000_000,
                    "amount": 500_000_000,
                    "turnover_rate": 1.1,
                },
            ],
        )

        self.assertEqual(row["date"], "20260720")
        self.assertEqual(row["stock_count"], 2)
        self.assertEqual(row["source"], "tushare_historical_reconstruction")
        self.assertEqual(top100[0]["code"], "600000")
        self.assertEqual(top100[0]["volume"], 123400)
        self.assertEqual(len(volume_top100), 2)
        self.assertTrue(all(item["source"] == row["source"] for item in top100))

    def test_tushare_bulk_units_are_normalized_before_aggregation(self):
        rows, counts = congestion.merge_tushare_historical_rows(
            "20260720",
            [{
                "ts_code": "600000.SH",
                "close": 12.34,
                "pre_close": 12.0,
                "pct_chg": 2.83,
                "vol": 1234,
                "amount": 2500,
            }],
            [{
                "ts_code": "600000.SH",
                "turnover_rate": 1.5,
                "volume_ratio": 0.8,
                "total_mv": 123456,
                "circ_mv": 100000,
            }],
            {"600000": "浦发银行"},
        )

        self.assertEqual(counts["joinedRowCount"], 1)
        self.assertEqual(rows[0]["volume"], 123400)
        self.assertEqual(rows[0]["amount"], 2_500_000)
        self.assertEqual(rows[0]["market_cap"], 1_234_560_000)
        self.assertEqual(rows[0]["float_market_cap"], 1_000_000_000)
        row, top100, _ = congestion.build_historical_trading_snapshot("20260720", rows)
        self.assertEqual(row["total_amount"], 2_500_000)
        self.assertEqual(top100[0]["volume"], 1234)
        self.assertEqual(top100[0]["volume_ratio"], 0.8)
        self.assertEqual(top100[0]["market_cap_yi"], 12.3)

    def test_tushare_daily_fallback_marks_unavailable_fields(self):
        rows = congestion.build_tushare_daily_fallback_rows(
            "20260804",
            [{
                "ts_code": "600000.SH",
                "trade_date": "20260804",
                "close": 12.34,
                "pre_close": 12.0,
                "pct_chg": 2.83,
                "vol": 1234,
                "amount": 2500,
            }],
            {"600000": "浦发银行"},
        )

        self.assertEqual(rows[0]["source"], "tushare_daily_fallback")
        self.assertEqual(rows[0]["volume"], 123400)
        self.assertEqual(rows[0]["amount"], 2_500_000)
        for field in [
            "turnover_rate", "volume_ratio", "market_cap", "float_market_cap"
        ]:
            self.assertIsNone(rows[0][field])

    def test_tushare_bulk_gate_accepts_date_specific_all_a_count(self):
        rows = [
            {"ts_code": "600000.SH", "trade_date": "20260804"},
            {"ts_code": "000001.SZ", "trade_date": "20260804"},
            {"ts_code": "920001.BJ", "trade_date": "20260804"},
        ]

        codes = congestion.validate_tushare_bulk_rows(
            "20260804", "daily", rows, min_row_count=3
        )

        self.assertEqual(codes, {"600000", "000001", "920001"})

    def test_tushare_bulk_gate_rejects_wrong_date_and_non_a_share(self):
        with self.assertRaisesRegex(RuntimeError, "date gate failed"):
            congestion.validate_tushare_bulk_rows(
                "20260804",
                "daily",
                [{"ts_code": "600000.SH", "trade_date": "20260803"}],
                expected_row_count=1,
            )
        with self.assertRaisesRegex(RuntimeError, "A-share universe gate failed"):
            congestion.validate_tushare_bulk_rows(
                "20260804",
                "daily",
                [{"ts_code": "510300.SH", "trade_date": "20260804"}],
                expected_row_count=1,
            )

    def test_tushare_historical_gate_requires_identical_code_sets(self):
        class Frame:
            def __init__(self, rows):
                self.rows = rows

            def to_dict(self, orientation):
                self_test.assertEqual(orientation, "records")
                return self.rows

        class Pro:
            def daily_basic(self, **kwargs):
                return Frame([
                    {"ts_code": "600000.SH", "trade_date": "20260804"},
                    {"ts_code": "000001.SZ", "trade_date": "20260804"},
                ])

            def daily(self, **kwargs):
                return Frame([
                    {"ts_code": "600000.SH", "trade_date": "20260804"},
                    {"ts_code": "920001.BJ", "trade_date": "20260804"},
                ])

        self_test = self
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(congestion, "HISTORICAL_SNAPSHOT_PROGRESS_DIR", Path(directory)):
                with self.assertRaisesRegex(RuntimeError, "universe gate failed"):
                    congestion.fetch_tushare_historical_rows(
                        "20260804", expected_row_count=2, pro=Pro(), retries=0
                    )

    def test_akshare_sina_row_maps_amount_turnover_and_volume_ratio(self):
        records = []
        for index, volume in enumerate([100, 110, 90, 105, 95, 150]):
            records.append({
                "date": f"2026-07-{13 + index:02d}" if index < 5 else "2026-07-20",
                "close": 10 + index,
                "volume": volume,
                "amount": 1000 + index,
                "turnover": 0.0123,
                "outstanding_share": 10000,
            })
        row = congestion.build_akshare_sina_historical_row(
            "20260720", "600000", "浦发银行", records
        )

        self.assertEqual(congestion.akshare_sina_symbol("600000"), "sh600000")
        self.assertEqual(congestion.akshare_sina_symbol("000001"), "sz000001")
        self.assertEqual(row["source"], "akshare_sina_historical_reconstruction")
        self.assertEqual(row["amount"], 1005)
        self.assertAlmostEqual(row["turnover_rate"], 1.23)
        self.assertAlmostEqual(row["volume_ratio"], 1.5)
        self.assertAlmostEqual(row["pct_chg"], 7.14285714285714)
        self.assertEqual(row["float_market_cap"], 150000)

    def test_tushare_daily_cache_is_reused_without_a_second_api_call(self):
        class Frame:
            def to_dict(self, orientation):
                self_test.assertEqual(orientation, "records")
                return [{"ts_code": "600000.SH", "trade_date": "20260720"}]

        class Pro:
            calls = 0

            def daily(self, **kwargs):
                self.calls += 1
                if self.calls > 1:
                    raise AssertionError("daily API called after valid cache was written")
                return Frame()

        self_test = self
        pro = Pro()
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(congestion, "HISTORICAL_SNAPSHOT_PROGRESS_DIR", Path(directory)):
                first = congestion.fetch_and_cache_tushare_daily_rows(
                    "20260720", expected_row_count=1, pro=pro
                )
                second = congestion.fetch_and_cache_tushare_daily_rows(
                    "20260720", expected_row_count=1, pro=pro
                )

        self.assertEqual(first, second)
        self.assertEqual(pro.calls, 1)

    def test_invalid_tushare_response_does_not_overwrite_cached_progress(self):
        class Frame:
            def to_dict(self, orientation):
                return [{"ts_code": "600000.SH", "trade_date": "20260803"}]

        class Pro:
            def daily(self, **kwargs):
                return Frame()

        with tempfile.TemporaryDirectory() as directory:
            progress_dir = Path(directory)
            cache_path = progress_dir / "tushare-20260804-daily.json"
            original = {
                "source": congestion.TUSHARE_HISTORICAL_SOURCE,
                "dataset": "daily",
                "date": "20260803",
                "rows": [{"ts_code": "600000.SH", "trade_date": "20260803"}],
            }
            cache_path.write_text(json.dumps(original), encoding="utf-8")
            with patch.object(congestion, "HISTORICAL_SNAPSHOT_PROGRESS_DIR", progress_dir):
                with self.assertRaisesRegex(RuntimeError, "date gate failed"):
                    congestion.fetch_and_cache_tushare_daily_rows(
                        "20260804", expected_row_count=1, pro=Pro()
                    )

            self.assertEqual(json.loads(cache_path.read_text(encoding="utf-8")), original)

    def test_quality_gate_requires_coverage_and_adjacent_count(self):
        passing = congestion.historical_snapshot_quality(
            {"stock_count": 5100},
            fetched_row_count=5524,
            universe_count=5524,
            adjacent_stock_counts=[5500, 5524],
            expected_row_count=5524,
        )
        failing = congestion.historical_snapshot_quality(
            {"stock_count": 4700},
            fetched_row_count=5523,
            universe_count=5524,
            adjacent_stock_counts=[5500, 5524],
            expected_row_count=5524,
        )

        self.assertTrue(passing["ok"])
        self.assertFalse(failing["ok"])
        self.assertEqual(len(failing["failures"]), 2)

    def test_merging_historical_snapshot_preserves_latest_current_date(self):
        with tempfile.TemporaryDirectory() as directory:
            cache_path = Path(directory) / "latest.json"
            payload = {
                "success": True,
                "data": {
                    "trading_congestion": {
                        "date": "20260721",
                        "source": "current source",
                        "stock_count": 5524,
                        "trend": [
                            {"date": "20260721", "source": "eastmoney_spot", "stock_count": 5524, "top1_ratio": 10},
                            {"date": "20260717", "source": "eastmoney_spot", "stock_count": 5500, "top1_ratio": 11},
                        ],
                        "top100": [{"code": "600000", "source": "eastmoney_spot"}],
                        "volume_top100": [{"code": "600000", "source": "eastmoney_spot"}],
                        "top100_by_date": {"20260721": [{"code": "600000", "source": "eastmoney_spot"}]},
                        "volume_top100_by_date": {"20260721": [{"code": "600000", "source": "eastmoney_spot"}]},
                    }
                },
            }
            cache_path.write_text(json.dumps(payload), encoding="utf-8")
            historical_row = {
                "date": "20260720",
                "source": "tushare_historical_reconstruction",
                "stock_count": 5100,
                "top1_ratio": 12,
                "top3_ratio": 20,
                "top5_ratio": 25,
            }
            historical_top = [{"code": "000001", "source": "tushare_historical_reconstruction"}]

            with patch.object(congestion, "TMT_CACHE", cache_path):
                congestion.merge_spot_snapshot_to_latest(
                    "20260720", historical_row, historical_top, historical_top
                )

            merged = json.loads(cache_path.read_text(encoding="utf-8"))["data"]["trading_congestion"]
            self.assertEqual(merged["date"], "20260721")
            self.assertEqual(merged["top100"][0]["code"], "600000")
            self.assertEqual(merged["top100_by_date"]["20260720"][0]["code"], "000001")
            self.assertEqual([item["date"] for item in merged["trend"][:3]], [
                "20260721", "20260720", "20260717"
            ])


if __name__ == "__main__":
    unittest.main()
