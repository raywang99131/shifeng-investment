import requests
from datetime import date
from typing import List, Dict, Optional

def _map_code_to_symbol(code: str) -> str:
    """Map stock code to Sina symbol prefix"""
    code = code.strip()
    if code.startswith('6') or code.startswith('688') or code.startswith('51') or code.startswith('58') or code.startswith('530') or code.startswith('563'):
        return f"sh{code}"
    elif code.startswith('0') or code.startswith('3') or code.startswith('2') or code.startswith('4') or code.startswith('9'):
        return f"sz{code}"
    return code

def fetch_single_quote(code: str) -> Optional[Dict]:
    """Fetch latest quote using Sina realtime API"""
    symbol = _map_code_to_symbol(code)
    try:
        url = f"http://hq.sinajs.cn/list={symbol}"
        headers = {
            'Referer': 'http://finance.sina.com.cn',
            'User-Agent': 'Mozilla/5.0',
        }
        r = requests.get(url, headers=headers, timeout=10)
        r.encoding = 'gbk'
        text = r.text.strip()
        if '=' not in text or '"' not in text:
            return None

        data_str = text.split('="')[1].split('"')[0]
        fields = data_str.split(',')

        if len(fields) < 10:
            return None

        name = fields[0]
        prev_close = float(fields[2])   # 昨收
        current = float(fields[3])      # 当前价
        today_open = float(fields[1])   # 今开
        high = float(fields[4])         # 最高
        low = float(fields[5])          # 最低
        volume = float(fields[8])       # 成交量
        amount = float(fields[9])       # 成交额
        trade_date_str = fields[30] if len(fields) > 30 else fields[30]
        trade_time = fields[31] if len(fields) > 31 else ''
        change = current - prev_close
        pct_chg = (change / prev_close * 100) if prev_close != 0 else 0

        return {
            "code": code,
            "name": name,
            "trade_date": trade_date_str,
            "close": current,
            "open": today_open,
            "high": high,
            "low": low,
            "volume": volume,
            "amount": amount,
            "pre_close": prev_close,
            "pct_chg": round(pct_chg, 2),
            "change": round(change, 2),
        }
    except Exception as e:
        return None

def fetch_batch_quotes(codes: List[str]) -> Dict:
    """Fetch quotes for multiple stocks using Sina batch API"""
    results = []
    errors = []

    # Sina supports up to ~50 codes per request
    batch_size = 30
    all_trade_dates = set()

    for i in range(0, len(codes), batch_size):
        batch = codes[i:i+batch_size]
        symbols = ','.join(_map_code_to_symbol(c) for c in batch)

        try:
            url = f"http://hq.sinajs.cn/list={symbols}"
            headers = {
                'Referer': 'http://finance.sina.com.cn',
                'User-Agent': 'Mozilla/5.0',
            }
            r = requests.get(url, headers=headers, timeout=15)
            r.encoding = 'gbk'
            lines = r.text.strip().split('\n')

            for j, line in enumerate(lines):
                if '=' not in line or '"' not in line:
                    if j < len(batch):
                        errors.append({"code": batch[j], "error": "Invalid response"})
                    continue

                data_str = line.split('="')[1].split('"')[0]
                fields = data_str.split(',')

                if len(fields) < 10:
                    if j < len(batch):
                        errors.append({"code": batch[j], "error": "Insufficient fields"})
                    continue

                code = batch[j]
                try:
                    prev_close = float(fields[2])
                    current = float(fields[3])
                    today_open = float(fields[1])
                    high = float(fields[4])
                    low = float(fields[5])
                    volume = float(fields[8])
                    amount = float(fields[9])
                    trade_date_str = fields[30] if len(fields) > 30 else ''
                    change = current - prev_close
                    pct_chg = (change / prev_close * 100) if prev_close != 0 else 0

                    if trade_date_str:
                        all_trade_dates.add(trade_date_str)

                    results.append({
                        "code": code,
                        "trade_date": trade_date_str,
                        "close": current,
                        "open": today_open,
                        "high": high,
                        "low": low,
                        "volume": volume,
                        "amount": amount,
                        "pre_close": prev_close,
                        "pct_chg": round(pct_chg, 2),
                        "change": round(change, 2),
                    })
                except (ValueError, IndexError) as e:
                    errors.append({"code": code, "error": str(e)})

        except Exception as e:
            for code in batch:
                errors.append({"code": code, "error": str(e)})

    trade_date = list(all_trade_dates)[0] if all_trade_dates else date.today().isoformat()

    return {
        "success": True,
        "trade_date": trade_date,
        "quotes": results,
        "errors": errors,
    }
