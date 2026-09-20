"""Retrospective CDS calibration diagnostics. Requires QuantLib==1.43.

This is an isolated experiment; it does not change the production data/model.
All target dates come from one rounded screenshot, not independent observations.
"""
import csv
import json
import math
import statistics as st
from pathlib import Path

import QuantLib as ql

ROOT = Path(__file__).resolve().parent
INPUT = json.loads((ROOT / 'evidence/local-inputs.json').read_text())
REFERENCE = json.loads((ROOT / 'evidence/screenshot-reference.json').read_text())
CURVES = {c['curveId']: c for c in INPUT['curves']}


def date(value):
    return ql.DateParser.parseISO(value)


def verify_independent_reference():
    """Port the public QuantLib/Markit single-quote reconciliation example.

    Expected NPV is external to our production model and this implementation.
    Source: QuantLib/test-suite/creditdefaultswap.cpp,
    testIsdaCalculatorReconcileSingleQuote (2021-07-26).
    """
    today = ql.Date(26, 7, 2021)
    ql.Settings.instance().evaluationDate = today
    cal = ql.WeekendsOnly()
    deposits = [ql.DepositRateHelper(r, ql.Period(m, ql.Months), 2, cal,
                ql.ModifiedFollowing, False, ql.Actual360())
                for m, r in zip([1, 3, 6, 12], [-.0056, -.005440, -.005190, -.004930])]
    index = ql.IborIndex('IsdaIbor', ql.Period(6, ql.Months), 2, ql.EURCurrency(),
                        cal, ql.ModifiedFollowing, False, ql.Actual360())
    swap_rates = [-.004820, -.004420, -.003990, -.003520, -.002970, -.002370,
                  -.001760, -.001140, -.000540, .000570, .001880, .002940, .002820]
    swaps = [ql.SwapRateHelper(r, ql.Period(y, ql.Years), cal, ql.Annual,
             ql.ModifiedFollowing, ql.Thirty360(ql.Thirty360.BondBasis), index)
             for y, r in zip([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30], swap_rates)]
    discount = ql.YieldTermStructureHandle(
        ql.PiecewiseLogLinearDiscount(0, cal, deposits + swaps, ql.Actual365Fixed()))
    maturity = ql.Date(20, 6, 2026)
    quoted = ql.MakeCreditDefaultSwap(maturity, .006713, nominal=1e6)
    hazard = quoted.impliedHazardRate(0., discount, ql.Actual365Fixed(), .4,
                                       1e-10, ql.CreditDefaultSwap.ISDA)
    probability = ql.DefaultProbabilityTermStructureHandle(
        ql.FlatHazardRate(today, ql.QuoteHandle(ql.SimpleQuote(hazard)), ql.Actual365Fixed()))
    engine = ql.IsdaCdsEngine(probability, .4, discount)
    trade = ql.MakeCreditDefaultSwap(maturity, .01, nominal=1e6, pricingEngine=engine)
    actual, expected = trade.NPV(), -16070.7
    # Upstream's tolerance is 0.001 percent, ~0.161 currency units.
    assert abs(actual - expected) < abs(expected) * .001 / 100
    assert abs(trade.accrualRebate().amount() - 1000.) < .01
    return {'expectedNpv': expected, 'actualNpv': actual,
            'absoluteNpvError': abs(actual - expected), 'accrualRebate': trade.accrualRebate().amount()}


def nym_calendar():
    cal = ql.BespokeCalendar('ISDA NYM from supplied public CSV')
    cal.addWeekend(ql.Saturday)
    cal.addWeekend(ql.Sunday)
    for line in (ROOT / 'evidence/NYM.csv').read_text().splitlines():
        raw = line.strip().split(',')[0].strip('"')
        if len(raw) == 8 and raw.isdigit():
            cal.addHoliday(date(f'{raw[:4]}-{raw[4:6]}-{raw[6:]}'))
        elif len(raw) == 10 and raw[4] == '-':
            cal.addHoliday(date(raw))
    return cal


CALENDAR = nym_calendar()


def discount_curve(row, shift=0.):
    today = date(row['clearingDate'])
    source = CURVES[row['curveId']]
    assert source['asOf'] == row['clearingDate']
    nodes = source['nodes']
    dates = [today] + [today + round(n['years'] * 365) for n in nodes]
    dfs = [1.] + [math.exp(-(n['zeroRate'] + shift) * ((d - today) / 365))
                  for n, d in zip(nodes, dates[1:])]
    # Same saved yield nodes; switch to log-linear discount interpolation, as
    # required by the ISDA engine. These remain Treasury PROXY inputs, not SOFR.
    curve = ql.DiscountCurve(dates, dfs, ql.Actual365Fixed())
    curve.enableExtrapolation()
    return ql.YieldTermStructureHandle(curve)


def trade(row, running=None, upfront=None):
    today = date(row['clearingDate'])
    ql.Settings.instance().evaluationDate = today
    schedule = ql.Schedule(today, date(row['maturityDate']), ql.Period(ql.Quarterly),
                           CALENDAR, ql.Following, ql.Unadjusted, ql.DateGeneration.CDS, False)
    return ql.CreditDefaultSwap(ql.Protection.Buyer, 1.,
            (100 - row['eodPrice']) / 100 if upfront is None else upfront,
            row['couponBp'] / 10000 if running is None else running,
            schedule, ql.Following, ql.Actual360(), True, True, today,
            CALENDAR.advance(today, 3, ql.Days), None, ql.Actual360(True), True, today, 3)


def price(row, shift=0.):
    cds = trade(row)
    return cds.conventionalSpread(row['recoveryRate'], discount_curve(row, shift),
                                  ql.Actual365Fixed(), ql.CreditDefaultSwap.ISDA) * 10000


def reference_implied_clean_price(row):
    """Equivalent clean price under fixed assumptions, not an observed quote."""
    quoted = trade(row, running=row['referenceBp'] / 10000, upfront=0.)
    discount = discount_curve(row)
    hazard = quoted.impliedHazardRate(0., discount, ql.Actual365Fixed(), row['recoveryRate'],
                                      1e-10, ql.CreditDefaultSwap.ISDA)
    probability = ql.DefaultProbabilityTermStructureHandle(ql.FlatHazardRate(
        date(row['clearingDate']), ql.QuoteHandle(ql.SimpleQuote(hazard)), ql.Actual365Fixed()))
    cds = trade(row, upfront=0.)
    cds.setPricingEngine(ql.IsdaCdsEngine(probability, row['recoveryRate'], discount))
    return 100 * (1 - cds.fairUpfront())


def inverse_shift(row):
    low, high = -.05, .05
    target = row['referenceBp']
    f_low, f_high = price(row, low) - target, price(row, high) - target
    if f_low * f_high > 0:
        return None
    for _ in range(45):
        mid = (low + high) / 2
        f_mid = price(row, mid) - target
        if f_low * f_mid <= 0:
            high = mid
        else:
            low, f_low = mid, f_mid
    return (low + high) / 2 * 10000


def metrics(errors):
    return {'n': len(errors), 'maeBp': st.mean(map(abs, errors)),
            'rmseBp': math.sqrt(st.mean(e * e for e in errors)),
            'maxAbsBp': max(map(abs, errors))}


def shared_curve_shift(training):
    # Deliberately one shared scalar for every issuer, not issuer-specific rates.
    def loss(s):
        return st.mean((price(r, s) - r['referenceBp']) ** 2 for r in training)
    low, high = -.02, .02
    for _ in range(36):
        a, b = (2 * low + high) / 3, (low + 2 * high) / 3
        if loss(a) < loss(b): high = b
        else: low = a
    return (low + high) / 2


def main():
    verification = verify_independent_reference()
    refs = {(c['company'], p['date']): p for c in REFERENCE['companies']
            for p in c['referencePoints']}
    observations = [{**r, **refs[(r['company'], r['clearingDate'])]}
                    for r in INPUT['derivedRows'] if (r['company'], r['clearingDate']) in refs]
    assert len(observations) == 18
    assert len({(r['company'], r['date']) for r in observations}) == 18
    assert CALENDAR.isHoliday(ql.Date(20, 6, 2022))
    for r in observations:
        r['originalBp'] = r['spreadBp']
        r['quantlibBp'] = price(r)
        r['impliedSharedCurveShiftBp'] = inverse_shift(r)
        r['equivalentCleanPriceForReference'] = reference_implied_clean_price(r)
        r['equivalentCleanPriceDifference'] = r['equivalentCleanPriceForReference'] - r['eodPrice']

    target = [r for r in observations if r['date'] == '2026-09-11']
    train = [r for r in observations if r['date'] == '2026-09-04']
    earlier = [r for r in observations if r['date'] < '2026-09-11']
    results = []

    def evaluate(name, predictions, parameters=None, training_dates=None):
        assert len(predictions) == len(target)
        results.append({'method': name, 'trainingDates': training_dates or [],
                        'targetDate': '2026-09-11', 'parameters': parameters,
                        **metrics([p - r['referenceBp'] for p, r in zip(predictions, target)]),
                        'predictions': [{'company': r['company'], 'referenceBp': r['referenceBp'],
                                         'predictionBp': p, 'errorBp': p - r['referenceBp']}
                                        for p, r in zip(predictions, target)]})

    evaluate('production_unadjusted', [r['originalBp'] for r in target])
    evaluate('quantlib_isda_with_treasury_proxy', [r['quantlibBp'] for r in target])
    for training, label in [(train, '0904'), (earlier, '0831_and_0904')]:
        for base in ['originalBp', 'quantlibBp']:
            offsets = {name: st.mean(r['referenceBp'] - r[base] for r in training if r['company'] == name)
                       for name in {r['company'] for r in training}}
            evaluate(f'{base}_issuer_offset_{label}',
                     [r[base] + offsets[r['company']] for r in target], offsets,
                     sorted({r['date'] for r in training}))
    shift = shared_curve_shift(train)
    evaluate('quantlib_one_shared_curve_shift_0904', [price(r, shift) for r in target],
             {'parallelShiftBp': shift * 10000}, ['2026-09-04'])
    x, y = [r['originalBp'] for r in train], [r['referenceBp'] for r in train]
    mx, my = st.mean(x), st.mean(y)
    slope = sum((a - mx) * (b - my) for a, b in zip(x, y)) / sum((a - mx) ** 2 for a in x)
    intercept = my - slope * mx
    evaluate('original_global_affine_0904', [intercept + slope * r['originalBp'] for r in target],
             {'intercept': intercept, 'slope': slope}, ['2026-09-04'])

    all_date_metrics = {base: metrics([r[base] - r['referenceBp'] for r in observations])
                        for base in ['originalBp', 'quantlibBp']}
    week_metrics = {}
    for base in ['originalBp', 'quantlibBp']:
        by_company = {r['company']: r for r in train}
        week_metrics[base] = metrics([(r[base] - by_company[r['company']][base]) -
            (r['referenceBp'] - by_company[r['company']]['referenceBp']) for r in target])
    output = {'quantlibVersion': ql.__version__, 'verification': verification,
              'referenceStatus': 'rounded secondary screenshot; Bloomberg field and tenor unverified',
              'validationStatus': 'retrospective diagnostics only; dates share screenshot anchor',
              'productionModified': False, 'observations': observations,
              'allDateLevelMetrics': all_date_metrics, 'weekChangeMetrics': week_metrics,
              'comparison': results}
    (ROOT / 'results.json').write_text(json.dumps(output, ensure_ascii=False, indent=2))
    columns = ['company', 'date', 'referenceBp', 'roundingHalfWidthBp', 'originalBp', 'quantlibBp',
               'eodPrice', 'equivalentCleanPriceForReference', 'equivalentCleanPriceDifference',
               'impliedSharedCurveShiftBp']
    with (ROOT / 'comparison.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(observations)
    print(json.dumps({'verification': verification, 'allDates': all_date_metrics,
                      'weekly': week_metrics, 'methods': [{k: v for k, v in r.items() if k != 'predictions'}
                                                          for r in results]}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
