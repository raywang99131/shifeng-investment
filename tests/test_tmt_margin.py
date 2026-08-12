import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd


TMT_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "macd screener/tmt_margin.py"
TMT_SPEC = importlib.util.spec_from_file_location("tmt_margin_completeness", TMT_SCRIPT_PATH)
tmt_margin = importlib.util.module_from_spec(TMT_SPEC)
TMT_SPEC.loader.exec_module(tmt_margin)


def _sz_rows():
    return pd.DataFrame([
        {
            "证券代码": "000001",
            "证券简称": "测试科技",
            "融资余额": 100_000_000,
            "融资买入额": 10_000_000,
            "融资偿还额": 5_000_000,
        }
    ])


SMALL_BOUNDS = {code: (1, 10) for code in tmt_margin.SW_TMT_INDUSTRIES}


def _membership_frames():
    return {
        "801080": pd.DataFrame([{"证券代码": "000001", "证券名称": "平凡股份"}]),
        "801750": pd.DataFrame([{"证券代码": "000002", "证券名称": "无关键词公司"}]),
        "801760": pd.DataFrame([{"证券代码": "000003", "证券名称": "内容公司"}]),
        "801770": pd.DataFrame([{"证券代码": "000004", "证券名称": "网络公司"}]),
    }


def _small_membership(asof="20260806"):
    return tmt_margin.build_sw_tmt_membership(
        _membership_frames(),
        classification_asof=asof,
        membership_mode="current_components_backfill",
        count_bounds=SMALL_BOUNDS,
    )


def _turnover_5914():
    values = {
        "801080": 34.83,
        "801750": 8.90,
        "801760": 3.26,
        "801770": 12.15,
    }
    return {
        "tmt_turnover_pct": 59.14,
        "tmt_turnover_by_industry": [
            {
                "industry_code": code,
                "industry_name": name,
                "turnover_pct": values[code],
            }
            for code, name in tmt_margin.SW_TMT_INDUSTRIES.items()
        ],
        "turnover_source": "swsresearch_index_analysis_daily_sw",
    }


class TmtMarginCompletenessTest(unittest.TestCase):
    def setUp(self):
        tmt_margin._STOCK_DETAIL_CACHE.clear()

    def test_stock_margin_detail_rejects_single_exchange_snapshot(self):
        with (
            patch.object(tmt_margin.ak, "stock_margin_detail_szse", return_value=_sz_rows()),
            patch.object(
                tmt_margin.ak,
                "stock_margin_detail_sse",
                side_effect=RuntimeError("controlled SSE failure"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "沪市"):
                tmt_margin.get_stock_margin_detail("20260805")

        self.assertNotIn("20260805", tmt_margin._STOCK_DETAIL_CACHE)

    def test_recent_trading_dates_use_only沪深_common_dates(self):
        sz = pd.DataFrame({"日期": ["2026-08-05", "2026-08-04", "2026-08-03"]})
        sh = pd.DataFrame({"日期": ["2026-08-05", "2026-08-03", "2026-08-02"]})
        with (
            patch.object(tmt_margin, "get_macro_sz", return_value=sz),
            patch.object(tmt_margin, "get_macro_sh", return_value=sh),
        ):
            self.assertEqual(
                tmt_margin.get_recent_trading_dates(3),
                ["20260805", "20260803"],
            )

    def test_market_total_rejects_missing_exchange_instead_of_treating_it_as_zero(self):
        sz = pd.DataFrame([
            {
                "日期_int": 20260805,
                "融资余额": 100_000_000,
                "融资买入额": 10_000_000,
            }
        ])
        sh = pd.DataFrame([
            {
                "日期_int": 20260804,
                "融资余额": 200_000_000,
                "融资买入额": 20_000_000,
            }
        ])
        with (
            patch.object(tmt_margin, "get_macro_sz", return_value=sz),
            patch.object(tmt_margin, "get_macro_sh", return_value=sh),
        ):
            with self.assertRaisesRegex(RuntimeError, "沪市市场两融汇总缺失"):
                tmt_margin.get_market_data("20260805")

    def test_quick_refresh_includes_gaps_in_recent_eleven_day_window(self):
        dates = [
            "20260805", "20260804", "20260803", "20260731", "20260730",
            "20260729", "20260728", "20260727", "20260724", "20260723",
            "20260722", "20260721",
        ]
        cached_dates = [date for date in dates if date != "20260731"]
        previous_payload = {
            "data": {
                "trend": [{"date": date, "tmt_count": 700} for date in cached_dates]
            }
        }

        target_dates = tmt_margin.get_target_dates(
            dates,
            include_history=False,
            previous_payload=previous_payload,
        )

        self.assertEqual(target_dates, ["20260805", "20260804", "20260731"])

    def test_history_alignment_keeps_rows_outside_requested_window(self):
        trading = {
            "trend": [
                {"date": "20260805", "top1_ratio": 20.0},
                {"date": "20120104", "top1_ratio": 12.0},
            ],
            "top100_by_date": {},
            "volume_top100_by_date": {},
        }

        aligned = tmt_margin.align_trading_congestion_trend(
            trading,
            ["20260805", "20260804"],
        )

        self.assertEqual(
            [row["date"] for row in aligned["trend"]],
            ["20260805", "20260804", "20120104"],
        )
        self.assertEqual(aligned["percentile_sample_count"], 2)


class StandardSwTmtDefinitionTest(unittest.TestCase):
    def setUp(self):
        tmt_margin._STOCK_DETAIL_CACHE.clear()

    def test_standard_pool_ignores_name_keywords_and_includes_keywordless_member(self):
        membership = _small_membership()
        margin = pd.DataFrame([
            {
                "code": "000001",
                "name": "平凡股份",
                "market": "sz",
                "yy": 200_000_000,
                "buy": 20_000_000,
                "repay": 10_000_000,
                "net_buy": 10_000_000,
            },
            {
                "code": "009999",
                "name": "万能科技",
                "market": "sz",
                "yy": 800_000_000,
                "buy": 80_000_000,
                "repay": 40_000_000,
                "net_buy": 40_000_000,
            },
        ])
        with (
            patch.object(tmt_margin, "get_stock_margin_detail", return_value=margin),
            patch.object(
                tmt_margin,
                "get_market_data",
                return_value={"market_yy": 10.0, "market_buy": 1.0},
            ),
        ):
            result = tmt_margin.get_tmt_data_for_date(
                "20260805",
                membership=membership,
                turnover=_turnover_5914(),
            )

        self.assertEqual(result["tmt_yy"], 2.0)
        self.assertEqual(result["pct"], 20.0)
        self.assertEqual(result["tmt_buy_pct"], 20.0)
        self.assertEqual(result["tmt_universe_count"], 4)
        self.assertEqual(result["tmt_margin_count"], 1)
        self.assertEqual(result["definition_id"], "sw2021_l1_tmt_v1")
        self.assertEqual(result["classification_asof"], "20260806")
        self.assertEqual(result["membership_mode"], "current_components_backfill")
        self.assertEqual(result["tmt_turnover_pct"], 59.14)

    def test_membership_hash_is_deterministic_and_classification_only(self):
        first = _small_membership()
        frames = _membership_frames()
        frames["801080"] = pd.DataFrame([{"证券代码": "000001", "证券名称": "已更名股份"}])
        second = tmt_margin.build_sw_tmt_membership(
            dict(reversed(list(frames.items()))),
            classification_asof="20260806",
            membership_mode="current_components_backfill",
            count_bounds=SMALL_BOUNDS,
        )
        self.assertEqual(first["membership_hash"], second["membership_hash"])

    def test_four_source_failure_preserves_last_good_and_writes_no_snapshot(self):
        frames = _membership_frames()

        def component_side_effect(symbol):
            if symbol == "801760":
                raise RuntimeError("controlled media failure")
            return frames[symbol]

        with tempfile.TemporaryDirectory() as temp_dir:
            last_good = Path(temp_dir) / "last-good.json"
            sentinel = {"sentinel": "unchanged"}
            last_good.write_text(json.dumps(sentinel), encoding="utf-8")
            with (
                patch.object(tmt_margin.ak, "index_component_sw", side_effect=component_side_effect) as mocked,
                patch.object(tmt_margin.time, "sleep"),
            ):
                with self.assertRaisesRegex(RuntimeError, "801760"):
                    tmt_margin.sync_sw_tmt_membership(
                        "20260806",
                        snapshot_dir=temp_dir,
                        count_bounds=SMALL_BOUNDS,
                    )

            self.assertEqual(json.loads(last_good.read_text(encoding="utf-8")), sentinel)
            self.assertFalse((Path(temp_dir) / "20260806.json").exists())
            called_symbols = {call.kwargs["symbol"] for call in mocked.call_args_list}
            self.assertEqual(called_symbols, set(tmt_margin.SW_TMT_INDUSTRIES))

    def test_official_turnover_is_sum_of_exact_four_industries(self):
        values = {
            "801080": 34.83,
            "801750": 8.90,
            "801760": 3.26,
            "801770": 12.15,
        }
        frame = pd.DataFrame([
            {
                "指数代码": code,
                "指数名称": tmt_margin.SW_TMT_INDUSTRIES[code],
                "发布日期": "2026-08-05",
                "成交额占比": value,
            }
            for code, value in values.items()
        ])
        result = tmt_margin.build_sw_tmt_turnover_history(frame, ["20260805"])["20260805"]
        self.assertEqual(result["tmt_turnover_pct"], 59.14)
        self.assertEqual(len(result["tmt_turnover_by_industry"]), 4)

        with self.assertRaisesRegex(RuntimeError, "四行业不完整"):
            tmt_margin.build_sw_tmt_turnover_history(frame.iloc[:-1], ["20260805"])

    def test_old_custom_history_is_rejected_instead_of_merged(self):
        membership = _small_membership()
        dates = ["20260805", "20260804", "20260803"]
        old_payload = {
            "data": {
                "trend": [
                    {"date": "20260805", "tmt_yy": 999.0, "pct": 23.72},
                    {"date": "20260804", "tmt_yy": 998.0, "pct": 23.50},
                ]
            }
        }
        self.assertEqual(
            tmt_margin.get_target_dates(
                dates,
                include_history=False,
                previous_payload=old_payload,
                current_membership=membership,
            ),
            dates,
        )
        new_row = {
            "date": "20260805",
            "definition_id": tmt_margin.DEFINITION_ID,
            "membership_mode": "current_components_backfill",
            "membership_hash": membership["membership_hash"],
            "tmt_turnover_pct": 59.14,
            "tmt_turnover_by_industry": _turnover_5914()["tmt_turnover_by_industry"],
            "tmt_yy": 100.0,
        }
        merged = tmt_margin.merge_trend(
            [new_row],
            old_payload,
            current_membership=membership,
        )
        self.assertEqual(merged, [new_row])

    def test_tagged_custom_history_with_wrong_industries_is_still_rejected(self):
        membership = _small_membership()
        fake_row = {
            "date": "20260804",
            "definition_id": tmt_margin.DEFINITION_ID,
            "membership_mode": "current_components_backfill",
            "membership_hash": membership["membership_hash"],
            "tmt_turnover_pct": 50.0,
            "tmt_turnover_by_industry": [
                {
                    "industry_code": "999999",
                    "industry_name": "人工科技池",
                    "turnover_pct": 50.0,
                }
            ],
            "tmt_yy": 999.0,
        }
        payload = {"data": {"trend": [fake_row]}}

        self.assertEqual(
            tmt_margin.merge_trend([], payload, current_membership=membership),
            [],
        )


if __name__ == "__main__":
    unittest.main()
