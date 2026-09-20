"""Bounded JSON batch conversion of CDS clean prices using QuantLib ISDA.

stdin: {schemaVersion: 1, records: [{id, clearingDate, maturityDate,
cleanPrice, couponBp, recoveryRate, discountCurve}]}.
Zero rates are continuous annual decimals on Actual/365 fixed. Historical
proxy node dates stay anchored to curve.asOf and D(t) is rebased by D(trade).
Dated standard discount factors must start at the valuation date with 1.
No curve extrapolation, market-data fetching, or fitted spread adjustments.

NYM.csv snapshot: https://www.cdsmodel.com/fee-computations.html (NYM link),
retrieved 2026-09-14. The small official file adds special holidays to weekends;
it is deliberately not the US government-bond or NYSE holiday calendar.
"""
import datetime as dt
import json
import math
from pathlib import Path
import re
import sys

import QuantLib as ql

MODEL_VERSION = 'quantlib-isda-v2'
MAX_BYTES = 16 * 1024 * 1024
MAX_RECORDS = 5000
MAX_NODES = 128
PRICE_TOLERANCE = 1e-7


class PricingError(ValueError):
    def __init__(self, message, code='INVALID_INPUT', row_id=None):
        super().__init__(message)
        self.code = code
        self.row_id = row_id


def require(condition, message):
    if not condition:
        raise PricingError(message)


def number(value, field, low=None, high=None):
    require(type(value) in (int, float) and math.isfinite(value),
            field + ' must be a finite JSON number')
    require(low is None or value >= low, field + ' is below the supported range')
    require(high is None or value <= high, field + ' is above the supported range')
    return float(value)


def identifier(value, field):
    require(isinstance(value, str) and 0 < len(value) <= 256 and value == value.strip()
            and not any(ord(c) < 32 for c in value), field + ' must be a nonempty identifier')
    return value


def date(value, field='date'):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value),
            field + ' must be YYYY-MM-DD')
    try:
        parsed = dt.date.fromisoformat(value)
        return ql.Date(parsed.day, parsed.month, parsed.year)
    except (ValueError, RuntimeError):
        raise PricingError(field + ' must be a valid supported calendar date') from None


def nym_calendar():
    calendar = ql.BespokeCalendar('ISDA NYM 2026-09-14')
    calendar.addWeekend(ql.Saturday)
    calendar.addWeekend(ql.Sunday)
    for raw in Path(__file__).with_name('NYM.csv').read_text().splitlines():
        require(re.fullmatch(r'\d{8}', raw) is not None, 'invalid bundled NYM calendar')
        calendar.addHoliday(date(raw[:4] + '-' + raw[4:6] + '-' + raw[6:]))
    return calendar


def make_trade(today, maturity, coupon, upfront, calendar, nominal=100.):
    """Full CDS coupon, accrual-on-default and settlement rebate convention.

    QuantLib takes trade date as protectionStart for CDS schedules; its ISDA
    engine uses max(protectionStart, evaluationDate+1) for effective protection.
    The step-in therefore remains T+1 calendar day, including weekends.
    """
    ql.Settings.instance().evaluationDate = today
    schedule = ql.Schedule(today, maturity, ql.Period(ql.Quarterly), calendar,
                           ql.Following, ql.Unadjusted, ql.DateGeneration.CDS, False)
    return ql.CreditDefaultSwap(ql.Protection.Buyer, nominal, upfront, coupon,
        schedule, ql.Following, ql.Actual360(), True, True, today,
        calendar.advance(today, 3, ql.Days), None, ql.Actual360(True), True, today, 3)


def build_discount_curve(source, today, coverage_date, currency='USD'):
    require(isinstance(source, dict), 'discountCurve must be an object')
    identifier(source.get('curveId'), 'curveId')
    require(source.get('currency') == currency, 'discount curve currency must be ' + currency)
    as_of = date(source.get('asOf'), 'curve.asOf')
    require(as_of <= today, 'curve.asOf cannot be after clearingDate')
    require(('nodes' in source) != ('discountFactors' in source),
            'curve requires exactly one of nodes or discountFactors')
    if 'nodes' in source:
        nodes = source['nodes']
        require(isinstance(nodes, list) and 1 <= len(nodes) <= MAX_NODES,
                'nodes must contain 1..128 entries')
        dates, factors = [as_of], [1.]
        for node in nodes:
            require(isinstance(node, dict), 'curve node must be an object')
            years = number(node.get('years'), 'node.years', 1 / 365, 100)
            rate = number(node.get('zeroRate'), 'node.zeroRate', -1, 1)
            node_date = as_of + round(years * 365)
            require(node_date > dates[-1], 'curve node dates must be strictly increasing and unique')
            dates.append(node_date)
            factors.append(math.exp(-rate * (node_date - as_of) / 365))
    else:
        require(as_of == today, 'dated discount curve asOf must match clearingDate')
        nodes = source['discountFactors']
        require(isinstance(nodes, list) and 2 <= len(nodes) <= MAX_NODES,
                'discountFactors must contain 2..128 entries')
        dates, factors = [], []
        for node in nodes:
            require(isinstance(node, dict), 'discount factor must be an object')
            node_date = date(node.get('date'), 'discountFactor.date')
            factor = number(node.get('discountFactor'), 'discountFactor')
            require(factor > 0, 'discount factors must be positive')
            require(not dates or node_date > dates[-1],
                    'discount factor dates must be strictly increasing and unique')
            dates.append(node_date)
            factors.append(factor)
        require(dates[0] == as_of and factors[0] == 1.,
                'discount curve must start at asOf with discount factor 1')
    require(dates[-1] >= coverage_date, 'discount curve does not cover final payment/settlement date')
    original = ql.DiscountCurve(dates, factors, ql.Actual365Fixed())
    if as_of < today:
        divisor = original.discount(today)
        future = [(d, f / divisor) for d, f in zip(dates, factors) if d > today]
        dates = [today] + [d for d, _ in future]
        factors = [1.] + [f for _, f in future]
    require(all(math.isfinite(f) and f > 0 for f in factors), 'invalid rebased discount factors')
    return ql.YieldTermStructureHandle(ql.DiscountCurve(dates, factors, ql.Actual365Fixed()))


def attach_engine(trade, today, recovery, discount, hazard):
    quote = ql.SimpleQuote(hazard)
    probability = ql.DefaultProbabilityTermStructureHandle(ql.FlatHazardRate(
        today, ql.QuoteHandle(quote), ql.Actual365Fixed()))
    trade.setPricingEngine(ql.IsdaCdsEngine(probability, recovery, discount, False,
        ql.IsdaCdsEngine.Taylor, ql.IsdaCdsEngine.HalfDayBias, ql.IsdaCdsEngine.Piecewise))
    return quote


def solve_hazard(trade, today, recovery, discount):
    # Fixed reference date also supports weekend diagnostic rows. QuantLib's
    # impliedHazardRate helper instead rolls its hazard reference to a weekday.
    quote = attach_engine(trade, today, recovery, discount, 0.)

    def objective(hazard):
        quote.setValue(hazard)
        return trade.NPV()

    zero = objective(0.)
    if abs(zero) < 1e-12:
        return 0.
    require(zero < 0, 'clean price implies a negative hazard rate/spread')
    high = 1.
    while objective(high) < 0 and high < 100:
        high = min(100., high * 2)
    require(objective(high) >= 0, 'clean price has no supported nonnegative hazard solution')
    solver = ql.Brent()
    solver.setMaxEvaluations(200)
    hazard = solver.solve(objective, 1e-12, min(.02, high / 2), 0., high)
    objective(hazard)
    return hazard


def price_record(row, calendar, currency='USD'):
    require(isinstance(row, dict), 'record must be an object')
    row_id = identifier(row.get('id'), 'id')
    today = date(row.get('clearingDate'), 'clearingDate')
    maturity = date(row.get('maturityDate'), 'maturityDate')
    require(maturity > today and maturity - today <= 50 * 366,
            'maturityDate must follow clearingDate by at most 50 years')
    require(maturity.dayOfMonth() == 20 and maturity.month() in (3, 6, 9, 12),
            'maturityDate must be a standard quarterly CDS date; no silent rolling is allowed')
    clean = number(row.get('cleanPrice'), 'cleanPrice', 0, 200)
    coupon = number(row.get('couponBp'), 'couponBp', 0, 10000) / 10000
    require(coupon > 0, 'couponBp must be positive')
    recovery = number(row.get('recoveryRate'), 'recoveryRate', 0, 1)
    require(recovery < 1, 'recoveryRate must be less than 1')
    trade = make_trade(today, maturity, coupon, (100 - clean) / 100, calendar)
    coverage = max(trade.upfrontPayment().date(), max(c.date() for c in trade.coupons()))
    discount = build_discount_curve(row.get('discountCurve'), today, coverage, currency)
    solve_hazard(trade, today, recovery, discount)
    spread = trade.fairSpread()
    require(math.isfinite(spread) and spread >= 0, 'calculated spread must be finite and nonnegative')
    # Re-invert the reported par spread, then reprice the fixed coupon. This
    # checks the whole price -> conventional spread -> clean price conversion.
    par = make_trade(today, maturity, spread, 0., calendar)
    hazard = solve_hazard(par, today, recovery, discount)
    round_trip = make_trade(today, maturity, coupon, 0., calendar)
    attach_engine(round_trip, today, recovery, discount, hazard)
    price = 100 * (1 - round_trip.fairUpfront())
    residual = abs(price - clean)
    require(math.isfinite(price) and residual <= PRICE_TOLERANCE,
            'price round-trip residual exceeds tolerance')
    source = row['discountCurve']
    return dict(id=row_id, spreadBp=spread * 10000, roundTripPrice=price,
                priceResidual=residual, curveId=source['curveId'], curveAsOf=source['asOf'],
                stepInDate=(today + 1).ISO(), cashSettlementDate=trade.upfrontPayment().date().ISO(),
                accrualRebatePer100=trade.accrualRebate().amount(), modelVersion=MODEL_VERSION)


def price_batch(payload):
    require(ql.__version__ == '1.43', 'QuantLib 1.43 is required')
    require(isinstance(payload, dict) and type(payload.get('schemaVersion')) is int
            and payload['schemaVersion'] == 1, 'schemaVersion must be 1')
    records = payload.get('records')
    require(isinstance(records, list) and 1 <= len(records) <= MAX_RECORDS,
            'records must contain 1..5000 entries')
    seen = set()
    for row in records:
        require(isinstance(row, dict), 'record must be an object')
        row_id = identifier(row.get('id'), 'id')
        require(row_id not in seen, 'record ids must be unique')
        seen.add(row_id)
    calendar = nym_calendar()
    rows = []
    for row in records:
        try:
            rows.append(price_record(row, calendar))
        except (ValueError, RuntimeError, OverflowError) as exc:
            raise PricingError(str(exc), getattr(exc, 'code', 'PRICING_FAILED'), row['id']) from None
    return dict(schemaVersion=1, engine='QuantLib ISDA', engineVersion=ql.__version__,
                modelVersion=MODEL_VERSION, rows=rows)


def self_check():
    """Published Markit/QuantLib single-quote case, 2021-07-26.

    https://github.com/lballabio/QuantLib/blob/v1.43/test-suite/creditdefaultswap.cpp
    testIsdaCalculatorReconcileSingleQuote: NPV -16070.7, accrual 1000.
    Tests our production trade convention, hazard solver and batch converter.
    Historical EUR rates are used only for this independent diagnostic case.
    """
    require(ql.__version__ == '1.43', 'QuantLib 1.43 is required')
    today, maturity = date('2021-07-26'), date('2026-06-20')
    ql.Settings.instance().evaluationDate = today
    weekdays = ql.WeekendsOnly()
    helpers = [ql.DepositRateHelper(r, ql.Period(m, ql.Months), 2, weekdays,
               ql.ModifiedFollowing, False, ql.Actual360()) for m, r in zip(
               [1, 3, 6, 12], [-.0056, -.005440, -.005190, -.004930])]
    index = ql.IborIndex('IsdaIbor', ql.Period(6, ql.Months), 2, ql.EURCurrency(),
                        weekdays, ql.ModifiedFollowing, False, ql.Actual360())
    helpers += [ql.SwapRateHelper(r, ql.Period(y, ql.Years), weekdays, ql.Annual,
                ql.ModifiedFollowing, ql.Thirty360(ql.Thirty360.BondBasis), index)
                for y, r in zip([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30],
                    [-.004820, -.004420, -.003990, -.003520, -.002970, -.002370,
                     -.001760, -.001140, -.000540, .000570, .001880, .002940, .002820])]
    bootstrapped = ql.PiecewiseLogLinearDiscount(0, weekdays, helpers, ql.Actual365Fixed())
    # Force bootstrap before extracting its pillars.
    bootstrapped.discount(maturity)
    discount = ql.YieldTermStructureHandle(bootstrapped)
    # Upstream uses WeekendsOnly for the historic contract; NYM added holidays
    # only in 2022. Use that exact reference convention for external NPV.
    quoted = make_trade(today, maturity, .006713, 0., weekdays, nominal=1e6)
    hazard = solve_hazard(quoted, today, .4, discount)
    trade = make_trade(today, maturity, .01, 0., weekdays, nominal=1e6)
    attach_engine(trade, today, .4, discount, hazard)
    actual, expected = trade.NPV(), -16070.7
    accrual = trade.accrualRebate().amount()
    require(abs(actual - expected) < .16071, 'independent Markit NPV benchmark failed')
    require(abs(accrual - 1000) < .01, 'independent accrual benchmark failed')
    # Exercise the production converter with the benchmark's historic calendar
    # and EUR curve. The stdin batch API always enforces USD and the NYM calendar.
    fixture = dict(id='markit-reference', clearingDate=today.ISO(), maturityDate=maturity.ISO(),
        cleanPrice=100 * (1 - trade.fairUpfront()), couponBp=100, recoveryRate=.4,
        discountCurve=dict(curveId='markit-2021-eur-diagnostic', asOf=today.ISO(), currency='EUR',
            discountFactors=[dict(date=d.ISO(), discountFactor=bootstrapped.discount(d))
                             for d in bootstrapped.dates()]))
    converted = price_record(fixture, weekdays, currency='EUR')
    require(abs(converted['spreadBp'] - 67.13) < .001, 'benchmark production conversion failed')
    return dict(schemaVersion=1, engine='QuantLib ISDA', engineVersion=ql.__version__,
        modelVersion=MODEL_VERSION, benchmark=dict(expectedNpv=expected, actualNpv=actual,
        absoluteNpvError=abs(actual - expected), accrualRebate=accrual,
        convertedSpreadBp=converted['spreadBp'], passed=True))


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON object key: ' + key)
        result[key] = value
    return result


def reject_constant(value):
    raise PricingError('non-finite JSON number: ' + value)


def main():
    try:
        if sys.argv[1:] == ['--self-check']:
            result = self_check()
        else:
            require(not sys.argv[1:], 'unsupported arguments')
            raw = sys.stdin.buffer.read(MAX_BYTES + 1)
            require(len(raw) <= MAX_BYTES, 'JSON input exceeds 16 MiB')
            payload = json.loads(raw, parse_constant=reject_constant, object_pairs_hook=unique_object)
            result = price_batch(payload)
        print(json.dumps(result, allow_nan=False, separators=(',', ':')))
        return 0
    except (ValueError, RuntimeError, OverflowError, RecursionError, OSError) as exc:
        error = dict(code=getattr(exc, 'code', 'INVALID_INPUT'), message=str(exc)[:1000])
        if getattr(exc, 'row_id', None) is not None:
            error['rowId'] = exc.row_id
        print(json.dumps(dict(schemaVersion=1, error=error), allow_nan=False, separators=(',', ':')))
        return 1


if __name__ == '__main__':
    sys.exit(main())
