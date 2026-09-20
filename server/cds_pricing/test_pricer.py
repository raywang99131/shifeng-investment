"""Executable API tests; benchmarks use published QuantLib/ISDA inputs."""
import copy
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

SCRIPT = Path(__file__).with_name('pricer.py')


def record(**changes):
    value = dict(id='oracle-2026-09-11', clearingDate='2026-09-11',
                 maturityDate='2031-06-20', cleanPrice=98.5, couponBp=100,
                 recoveryRate=.4, discountCurve=dict(curveId='test-proxy',
                 asOf='2026-09-11', currency='USD', nodes=[
                     dict(years=1, zeroRate=.04), dict(years=10, zeroRate=.04)]))
    value.update(changes)
    return value


class PricerTests(unittest.TestCase):
    def invoke(self, records=None, raw=None, args=()):
        if raw is None:
            raw = json.dumps(dict(schemaVersion=1, records=records or [record()]))
        result = subprocess.run([sys.executable, str(SCRIPT), *args], input=raw,
                                text=True, capture_output=True, timeout=30)
        return result

    def successful(self, records):
        result = self.invoke(records)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        return json.loads(result.stdout)

    def rejected(self, records=None, raw=None):
        result = self.invoke(records, raw)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(result.stdout.strip(), 'failure must return a structured JSON error')
        output = json.loads(result.stdout)
        self.assertIn('error', output)
        self.assertNotIn('rows', output)
        self.assertTrue(output['error']['code'])
        self.assertTrue(output['error']['message'])

    def test_published_markit_benchmark_and_production_conversion(self):
        result = self.invoke(args=['--self-check'])
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        benchmark = json.loads(result.stdout)['benchmark']
        self.assertLess(abs(benchmark['actualNpv'] - (-16070.7)), .16071)
        self.assertAlmostEqual(benchmark['accrualRebate'], 1000., places=5)
        self.assertLess(abs(benchmark['convertedSpreadBp'] - 67.13), .001)

    def test_par_quote_and_non_par_round_trip(self):
        output = self.successful([record(id='par', cleanPrice=100), record()])
        self.assertEqual(output['engine'], 'QuantLib ISDA')
        self.assertEqual(output['engineVersion'], '1.43')
        self.assertAlmostEqual(output['rows'][0]['spreadBp'], 100., places=5)
        result = output['rows'][1]
        self.assertGreater(result['spreadBp'], 100)
        self.assertAlmostEqual(result['roundTripPrice'], 98.5, places=7)
        self.assertGreaterEqual(result['priceResidual'], 0)
        self.assertLess(abs(result['priceResidual']), 1e-7)
        self.assertEqual(result['curveAsOf'], '2026-09-11')

    def test_friday_step_in_is_saturday_and_cash_settlement_wednesday(self):
        result = self.successful([record()])['rows'][0]
        self.assertEqual(result['stepInDate'], '2026-09-12')
        self.assertEqual(result['cashSettlementDate'], '2026-09-16')

    def test_public_coupon_boundary_accrual_examples(self):
        # Upstream testAccrualRebateAmounts, not expectations from our own engine.
        examples = [('2009-03-18', .2416667), ('2009-03-19', 0),
                    ('2009-03-20', .0027778), ('2009-06-19', .2555556),
                    ('2009-06-20', .2583333), ('2009-06-21', 0),
                    ('2009-06-22', .0027778)]
        rows = []
        for day, expected in examples:
            item = record(id=day, clearingDate=day, maturityDate='2014-06-20')
            item['discountCurve']['asOf'] = day
            rows.append(item)
        output = self.successful(rows)
        for result, (_, expected) in zip(output['rows'], examples):
            self.assertAlmostEqual(result['accrualRebatePer100'], expected, places=7)

    def test_nym_juneteenth_cash_settlement(self):
        item = record(clearingDate='2022-06-17', maturityDate='2027-06-20')
        item['discountCurve']['asOf'] = '2022-06-17'
        result = self.successful([item])['rows'][0]
        self.assertEqual(result['stepInDate'], '2022-06-18')
        self.assertEqual(result['cashSettlementDate'], '2022-06-23')

    def test_prior_proxy_curve_rebases_discounts_without_shifting_nodes(self):
        prior = record()
        prior['discountCurve']['asOf'] = '2026-09-10'
        prior['discountCurve']['nodes'] = [dict(years=1, zeroRate=.01),
                                          dict(years=10, zeroRate=.08)]
        # Source dates are 2027-09-10 and 2036-09-07 (365 and 3650 days).
        # Divide both original factors by D(2026-09-11)=exp(-.01/365).
        standard = record(id='explicit-rebased')
        standard['discountCurve'] = dict(curveId='explicit', asOf='2026-09-11',
            currency='USD', discountFactors=[
                dict(date='2026-09-11', discountFactor=1),
                dict(date='2027-09-10', discountFactor=math.exp(-.01 + .01/365)),
                dict(date='2036-09-07', discountFactor=math.exp(-.8 + .01/365))])
        output = self.successful([prior, standard])['rows']
        self.assertAlmostEqual(output[0]['spreadBp'], output[1]['spreadBp'], places=7)
        self.assertEqual(output[0]['curveAsOf'], '2026-09-10')

    def test_invalid_scalars_dates_ids_and_contracts_fail_whole_batch(self):
        cases = [('cleanPrice', True), ('cleanPrice', float('nan')),
                 ('cleanPrice', float('inf')), ('cleanPrice', '99'),
                 ('cleanPrice', -1), ('cleanPrice', 200),
                 ('couponBp', False), ('couponBp', 0), ('couponBp', -100),
                 ('recoveryRate', 1), ('recoveryRate', -.1),
                 ('clearingDate', '2026-02-30'), ('clearingDate', '2026-9-11'),
                 ('maturityDate', '2025-06-20'), ('maturityDate', '2031-06-19'),
                 ('id', ''), ('id', 5), ('discountCurve', None)]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                self.rejected([record(id='valid'), record(**{key: value})])
        self.rejected([record(), record()])

    def test_invalid_curve_nodes_and_provenance(self):
        cases = [('asOf', '2026-09-12'), ('asOf', '2026-02-30'),
                 ('currency', 'EUR'), ('curveId', ''),
                 ('nodes', []), ('nodes', [dict(years=1, zeroRate=.04)]),
                 ('nodes', [dict(years=10, zeroRate=True)]),
                 ('nodes', [dict(years=10, zeroRate=float('nan'))]),
                 ('nodes', [dict(years=0, zeroRate=.04)]),
                 ('nodes', [dict(years=10, zeroRate=.04), dict(years=1, zeroRate=.04)]),
                 ('nodes', [dict(years=10, zeroRate=.04), dict(years=10, zeroRate=.05)])]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                item = record()
                item['discountCurve'][key] = value
                self.rejected([item])

    def test_invalid_dated_discount_curves(self):
        valid = dict(curveId='standard', asOf='2026-09-11', currency='USD',
                     discountFactors=[dict(date='2026-09-11', discountFactor=1),
                                      dict(date='2036-09-11', discountFactor=.6)])
        self.successful([record(discountCurve=valid)])
        mutations = [lambda c: c.update(asOf='2026-09-10'),
                     lambda c: c.update(nodes=[dict(years=10, zeroRate=.04)]),
                     lambda c: c['discountFactors'][0].update(discountFactor=.99),
                     lambda c: c['discountFactors'][1].update(discountFactor=0),
                     lambda c: c['discountFactors'][1].update(discountFactor=True),
                     lambda c: c['discountFactors'][1].update(date='2026-09-11'),
                     lambda c: c['discountFactors'][1].update(date='2026-02-30'),
                     lambda c: c['discountFactors'][1].update(date='2027-09-11')]
        for mutate in mutations:
            curve = copy.deepcopy(valid)
            mutate(curve)
            self.rejected([record(discountCurve=curve)])

    def test_json_schema_duplicate_keys_and_bounded_input(self):
        for raw in ['{}', 'null', '{', '{"schemaVersion":true,"records":[]}',
                    '{"schemaVersion":1,"schemaVersion":1,"records":[]}',
                    '{"schemaVersion":1,"records":[]}', ' ' * (16 * 1024 * 1024 + 1)]:
            self.rejected(raw=raw)
        self.rejected(raw=json.dumps(dict(schemaVersion=1, records=[record(id=str(i))
                                                                   for i in range(5001)])))


if __name__ == '__main__':
    unittest.main()
