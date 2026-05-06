import requests
from datetime import date
from typing import List, Dict, Optional

def _map_code_to_prefix(code: str) -> str:
    """Map stock code to Tencent Finance URL prefix"""
    code = code.strip()
    if code.startswith('6') or code.startswith('688') or code.startswith('51') or code.startswith('58') or code.startswith('530') or code.startswith('563'):
        return 'sh'
    elif code.startswith('0') or code.startswith('3') or code.startswith('2') or code.startswith('4') or code.startswith('9'):
        return 'sz'
    return 'sz'

def _parse_tencent_line(code: str, line: str) -> Optional[Dict]:
    """Parse a single Tencent Finance API response line"""
    try:
        if '=' not in line or '"' not in line:
            return None
        # v_sz000001="51~平安银行~000001~11.47~11.46~..."
        data_str = line.split('="')[1].strip('";')
        fields = data_str.split('~')

        if len(fields) < 5:
            return None

        current = float(fields[3]) if fields[3] else 0
        prev_close = float(fields[4]) if fields[4] else 0

        # pct_chg is at index 32 as percentage string "0.09"
        pct_chg = float(fields[32]) if len(fields) > 32 and fields[32] else 0

        # timestamp at index 30: "20260429113233" -> "2026-04-29"
        ts = fields[30] if len(fields) > 30 else ''
        trade_date = f'{ts[0:4]}-{ts[4:6]}-{ts[6:8]}' if len(ts) >= 8 else date.today().isoformat()

        change = current - prev_close
        if prev_close > 0:
            pct_chg = (change / prev_close) * 100

        return {
            'code': code,
            'trade_date': trade_date,
            'close': current,
            'open': float(fields[9]) if len(fields) > 9 and fields[9] else 0,
            'high': float(fields[33]) if len(fields) > 33 and fields[33] else 0,
            'low': float(fields[34]) if len(fields) > 34 and fields[34] else 0,
            'volume': float(fields[6]) if len(fields) > 6 and fields[6] else 0,
            'pre_close': prev_close,
            'pct_chg': round(pct_chg, 2),
            'change': round(change, 2),
        }
    except Exception:
        return None

def fetch_single_quote(code: str) -> Optional[Dict]:
    """Fetch latest quote using Tencent Finance API (real-time, no caching)"""
    prefix = _map_code_to_prefix(code)
    try:
        url = f'https://qt.gtimg.cn/q={prefix}{code}'
        headers = {'Referer': 'http://finance.qq.com', 'User-Agent': 'Mozilla/5.0'}
        r = requests.get(url, timeout=5)
        r.encoding = 'gbk'
        text = r.text.strip()
        return _parse_tencent_line(code, text)
    except Exception:
        return None

def fetch_batch_quotes(codes: List[str]) -> Dict:
    """Fetch quotes for multiple stocks using Tencent Finance batch API"""
    symbols = ','.join(f'{_map_code_to_prefix(c)}{c}' for c in codes)
    results = []
    errors = []

    try:
        url = f'https://qt.gtimg.cn/q={symbols}'
        headers = {'Referer': 'http://finance.qq.com', 'User-Agent': 'Mozilla/5.0'}
        r = requests.get(url, timeout=10)
        r.encoding = 'gbk'
        lines = r.text.strip().split('\n')

        for line in lines:
            if not line or '=' not in line:
                continue
            # Extract code from "v_sz000001=..."
            try:
                key_part = line.split('=')[0].strip()  # "v_sz000001"
                # Extract prefix+code
                prefix_code = key_part.replace('v_', '')  # "sz000001"
                # Find matching code from our list
                matched_code = None
                for c in codes:
                    if prefix_code.endswith(c):
                        matched_code = c
                        break
                if not matched_code:
                    continue

                quote = _parse_tencent_line(matched_code, line)
                if quote:
                    results.append(quote)
                else:
                    errors.append({'code': matched_code, 'error': 'Parse failed'})
            except Exception as e:
                errors.append({'code': 'unknown', 'error': str(e)})

    except Exception as e:
        for code in codes:
            errors.append({'code': code, 'error': str(e)})

    trade_date = results[0]['trade_date'] if results else date.today().isoformat()

    return {
        'success': True,
        'trade_date': trade_date,
        'quotes': results,
        'errors': errors,
    }

def fetch_kline(code: str, period: str = "daily", count: int = 60) -> Optional[Dict]:
    """Fetch historical K-line data using Sina Finance API"""
    try:
        import requests
        # 沪深A股前缀
        if code.startswith('6') or code.startswith('688') or code.startswith('5'):
            prefix = 'sh'
        else:
            prefix = 'sz'
        symbol = f"{prefix}{code}"

        # scale: 日K用240分钟，周K用1440，月K用7200
        scale_map = {'daily': '240', 'weekly': '1440', 'monthly': '7200'}
        scale = scale_map.get(period, '240')

        url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'
        params = {'symbol': symbol, 'scale': scale, 'ma': '5', 'datalen': str(count)}
        headers = {'Referer': 'http://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0'}

        r = requests.get(url, params=params, timeout=10)
        r.encoding = 'utf-8'
        raw = r.text

        import json
        items = json.loads(raw)
        if not isinstance(items, list):
            return {'success': False, 'error': 'Invalid response', 'code': code, 'data': []}

        # 反转让数据按日期正序
        items = list(reversed(items))

        data = []
        prev_close = None
        for item in items:
            open_ = float(item.get('open', 0))
            high = float(item.get('high', 0))
            low = float(item.get('low', 0))
            close = float(item.get('close', 0))
            volume = float(item.get('volume', 0))
            pct_chg = 0.0
            if prev_close is not None and prev_close > 0:
                pct_chg = (close - prev_close) / prev_close * 100
            data.append({
                'date': item.get('day', ''),
                'open': open_,
                'high': high,
                'low': low,
                'close': close,
                'volume': volume,
                'pct_chg': round(pct_chg, 2),
            })
            prev_close = close

        return {'success': True, 'code': code, 'data': data}
    except Exception as e:
        return {'success': False, 'error': str(e), 'code': code, 'data': []}
