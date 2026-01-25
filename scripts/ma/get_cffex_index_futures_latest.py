import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path


def _load_env_from_files():
    candidates = []
    try:
        cwd = Path.cwd()
        candidates.append(cwd)
    except Exception:
        pass
    try:
        script_dir = Path(__file__).resolve().parent
        candidates.append(script_dir)
        candidates.append(script_dir.parent)
        candidates.append(script_dir.parent.parent)
    except Exception:
        pass

    for base in candidates:
        for fname in (".env", ".env.local"):
            f = base / fname
            if f.exists() and f.is_file():
                try:
                    for line in f.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" not in line:
                            continue
                        key, val = line.split("=", 1)
                        key = key.strip()
                        val = val.strip().strip('"').strip("'")
                        if key and os.environ.get(key) is None:
                            os.environ[key] = val
                except Exception:
                    pass


def _latest_trade_date(pro):
    # Use SSE trading calendar as authoritative for A-share indices
    try:
        cal = pro.trade_cal(
            exchange='SSE',
            start_date=(datetime.today() - timedelta(days=30)).strftime('%Y%m%d'),
            end_date=datetime.today().strftime('%Y%m%d'),
        )
        open_days = []
        for _, row in cal.iterrows():
            try:
                val = row['is_open']
                if isinstance(val, str):
                    is_open = val.strip() == '1'
                else:
                    is_open = int(val) == 1
            except Exception:
                is_open = False
            if is_open:
                open_days.append(row['cal_date'])
        if open_days:
            return max(open_days)
    except Exception:
        pass
    # Fallback: walk back from today to find an open day
    d = datetime.today()
    for i in range(0, 15):
        dd = d - timedelta(days=i)
        s = dd.strftime('%Y%m%d')
        try:
            cal = pro.trade_cal(exchange='SSE', start_date=s, end_date=s)
            if cal is not None and not cal.empty:
                row = cal.iloc[-1]
                if row.get('is_open') == 1:
                    return s
        except Exception:
            pass
    return d.strftime('%Y%m%d')

def _latest_data_date(pro):
    # Use CSI 300 index as proxy to detect most recent date with data
    anchor = '000300.SH'
    d = datetime.today()
    for i in range(0, 20):
        dt = (d - timedelta(days=i)).strftime('%Y%m%d')
        try:
            df = pro.index_daily(ts_code=anchor, start_date=dt, end_date=dt)
            if df is not None and not df.empty:
                return dt
        except Exception:
            pass
    return d.strftime('%Y%m%d')

def _adjust_for_weekend(today: datetime) -> str:
    # If Saturday (5) -> Friday; if Sunday (6) -> Friday
    wd = today.weekday()
    if wd == 5:
        return (today - timedelta(days=1)).strftime('%Y%m%d')
    if wd == 6:
        return (today - timedelta(days=2)).strftime('%Y%m%d')
    return today.strftime('%Y%m%d')


def _try_fut_main_daily(pro, fut_code, trade_date):
    try:
        df = pro.fut_main_daily(exchange='CFFEX', fut_code=fut_code, start_date=trade_date, end_date=trade_date)
        if df is not None and not df.empty:
            row = df.iloc[-1]
            # Expected fields: close, settle, pct_chg (some versions may use change_rate)
            close = float(row.get('close')) if row.get('close') is not None else None
            settle = row.get('settle')
            try:
                settle = float(settle) if settle is not None else None
            except Exception:
                settle = None
            # settle return: if pct_chg exists use that; else compute from settle/prev_settle if available
            pct = row.get('pct_chg')
            try:
                pct = float(pct) if pct is not None else None
            except Exception:
                pct = None
            if pct is None:
                pct = row.get('change_rate')
                try:
                    pct = float(pct) if pct is not None else None
                except Exception:
                    pct = None
            return {
                'close': close,
                'settle': settle,
                'settle_return': pct,
            }
    except Exception:
        pass
    return None


def _fallback_index_daily(pro, index_code, trade_date):
    try:
        df = pro.index_daily(ts_code=index_code, start_date=trade_date, end_date=trade_date)
        if df is not None and not df.empty:
            row = df.iloc[-1]
            close = float(row.get('close')) if row.get('close') is not None else None
            # Use percent change if available; otherwise compute from pre_close
            pct = row.get('pct_chg')
            try:
                pct = float(pct) if pct is not None else None
            except Exception:
                pct = None
            if pct is None:
                pre_close = row.get('pre_close')
                try:
                    if pre_close is not None and close is not None and float(pre_close) != 0:
                        pct = (close / float(pre_close) - 1.0) * 100.0
                except Exception:
                    pct = None
            return {
                'close': close,
                'settle': None,
                'settle_return': pct,
            }
    except Exception:
        pass
    return None


def _fetch_fut_daily_for_date(pro, trade_date):
    # Try with explicit exchange first, then without
    fields = 'ts_code,trade_date,pre_close,pre_settle,open,high,low,close,settle,vol,oi'
    try:
        df = pro.fut_daily(trade_date=trade_date, exchange='CFFEX', fields=fields)
        if df is not None and not df.empty:
            return df
    except Exception:
        pass
    try:
        df = pro.fut_daily(trade_date=trade_date, exchange='', fields=fields)
        if df is not None and not df.empty:
            return df
    except Exception:
        pass
    try:
        # Last resort without exchange param at all
        df = pro.fut_daily(trade_date=trade_date, fields=fields)
        if df is not None and not df.empty:
            return df
    except Exception:
        pass
    return None


def _select_main_contract_row(df, prefix: str):
    try:
        cands = df[df['ts_code'].str.startswith(prefix)]
        if cands is None or cands.empty:
            return None
        # Prefer highest open interest, then highest volume, then latest ts_code
        if 'oi' in cands.columns and cands['oi'].notna().any():
            cands = cands.sort_values(by=['oi', 'vol', 'ts_code'], ascending=[False, False, False])
        elif 'vol' in cands.columns and cands['vol'].notna().any():
            cands = cands.sort_values(by=['vol', 'ts_code'], ascending=[False, False])
        else:
            cands = cands.sort_values(by=['ts_code'], ascending=False)
        return cands.iloc[0]
    except Exception:
        return None


def _select_far_month_row(df, prefix: str):
    try:
        cands = df[df['ts_code'].str.startswith(prefix)]
        if cands is None or cands.empty:
            return None
        # Far month: pick the largest ts_code (YYMM) lexicographically
        cands = cands.sort_values(by=['ts_code'], ascending=False)
        return cands.iloc[0]
    except Exception:
        return None

def _fetch_continuous_contract(pro, ts_code: str, trade_date: str):
    fields = 'ts_code,trade_date,pre_close,pre_settle,open,high,low,close,settle,vol'
    # Try the given date; if no data, walk back a few days
    for back in range(0, 8):
        dt = (datetime.strptime(trade_date, '%Y%m%d') - timedelta(days=back)).strftime('%Y%m%d')
        # Try with explicit CFFEX exchange, then without, then with empty exchange
        for exch in ('CFFEX', None, ''):
            try:
                kwargs = {'trade_date': dt, 'ts_code': ts_code, 'fields': fields}
                if exch is not None:
                    kwargs['exchange'] = exch
                df = pro.fut_daily(**kwargs)
                if df is not None and not df.empty:
                    row = df.iloc[-1]
                    try:
                        close = float(row.get('close')) if row.get('close') is not None else None
                    except Exception:
                        close = None
                    try:
                        settle = float(row.get('settle')) if row.get('settle') is not None else None
                    except Exception:
                        settle = None
                    pct = None
                    try:
                        pre_settle = row.get('pre_settle')
                        if pre_settle is not None and close is not None and float(pre_settle) != 0:
                            pct = (close / float(pre_settle) - 1.0) * 100.0
                    except Exception:
                        pass
                    if pct is None:
                        try:
                            pre_close = row.get('pre_close')
                            if pre_close is not None and close is not None and float(pre_close) != 0:
                                pct = (close / float(pre_close) - 1.0) * 100.0
                        except Exception:
                            pass
                    return {
                        'ts_code': row.get('ts_code') or ts_code,
                        'trade_date': str(row.get('trade_date', dt)),
                        'close': close,
                        'settle': settle,
                        'settle_return': float(pct) if pct is not None else None,
                    }
            except Exception:
                pass
    return None


def main():
    _load_env_from_files()
    token = os.environ.get('TUSHARE_TOKEN')
    if not token:
        print(json.dumps({'error': 'Missing TUSHARE_TOKEN in environment'}))
        sys.exit(2)

    try:
        import tushare as ts
        pro = ts.pro_api(token)
    except Exception as e:
        print(json.dumps({'error': f'Tushare import/init failed: {e}'}))
        sys.exit(1)

    # Prefer actual data presence over calendar on non-trading days
    trade_date = _latest_data_date(pro)
    if trade_date == datetime.today().strftime('%Y%m%d'):
        # If no data was found, adjust for weekend
        trade_date = _adjust_for_weekend(datetime.today())

    # Preferred: use fut_daily of the trading day and pick main contract by OI/volume
    prefixes = ['IH', 'IF', 'IC', 'IM']
    result = {}
    used_dates = []
    df = _fetch_fut_daily_for_date(pro, trade_date)
    if df is None or df.empty:
        # walk back to find a day with data
        for back in range(1, 6):
            dt = (datetime.strptime(trade_date, '%Y%m%d') - timedelta(days=back)).strftime('%Y%m%d')
            df = _fetch_fut_daily_for_date(pro, dt)
            if df is not None and not df.empty:
                trade_date = dt
                break

    if df is not None and not df.empty:
        for code in prefixes:
            row = _select_main_contract_row(df, code)
            far_row = _select_far_month_row(df, code)
            if row is not None:
                try:
                    close = float(row.get('close')) if row.get('close') is not None else None
                except Exception:
                    close = None
                try:
                    settle = float(row.get('settle')) if row.get('settle') is not None else None
                except Exception:
                    settle = None
                # settle_return: (today close - yesterday settle) / yesterday settle * 100
                pct = None
                try:
                    pre_settle = row.get('pre_settle')
                    if pre_settle is not None and close is not None and float(pre_settle) != 0:
                        pct = (close / float(pre_settle) - 1.0) * 100.0
                except Exception:
                    pass
                # Fallback: use pre_close if pre_settle missing
                if pct is None:
                    try:
                        pre_close = row.get('pre_close')
                        if pre_close is not None and close is not None and float(pre_close) != 0:
                            pct = (close / float(pre_close) - 1.0) * 100.0
                    except Exception:
                        pass
                used_dates.append(str(row.get('trade_date', trade_date)))
                # Far month details (lexicographically far from daily pool)
                try:
                    far_close = float(far_row.get('close')) if (far_row is not None and far_row.get('close') is not None) else None
                except Exception:
                    far_close = None
                far_ts = far_row.get('ts_code') if far_row is not None else None
                # Fallback: if far month not found, use main contract as far to enable basis calc
                if far_close is None and close is not None:
                    far_close = close
                if far_ts is None and row.get('ts_code') is not None:
                    far_ts = row.get('ts_code')

                # Explicit continuous contracts: near (L) and next (L1)
                near_cont = _fetch_continuous_contract(pro, f"{code}L.CFX", trade_date)
                far_cont = _fetch_continuous_contract(pro, f"{code}L1.CFX", trade_date)
                result[code] = {
                    'ts_code': row.get('ts_code'),
                    'trade_date': str(row.get('trade_date', trade_date)),
                    'close': close,
                    'settle': settle,
                    'settle_return': float(pct) if pct is not None else None,
                    'far_ts_code': far_ts,
                    'far_close': far_close,
                    # Continuous: 当月连续 (近月)
                    'near_ts_code': near_cont.get('ts_code') if near_cont else None,
                    'near_close': near_cont.get('close') if near_cont else None,
                    'near_settle': near_cont.get('settle') if near_cont else None,
                    'near_settle_return': near_cont.get('settle_return') if near_cont else None,
                    # Continuous: 下月连续 (远月)
                    'far_cont_ts_code': far_cont.get('ts_code') if far_cont else None,
                    'far_settle': far_cont.get('settle') if far_cont else None,
                    'far_settle_return': far_cont.get('settle_return') if far_cont else None,
                    'source': 'fut_daily',
                }
            else:
                result[code] = {
                    'ts_code': None,
                    'trade_date': trade_date,
                    'close': None,
                    'settle': None,
                    'settle_return': None,
                    'far_ts_code': None,
                    'far_close': None,
                    'source': 'fut_daily',
                }
    else:
        # Fallback: use underlying indices if we cannot get fut_daily (permissions or holiday)
        idx_map = {
            'IH': '000016.SH',  # SSE 50
            'IF': '000300.SH',  # CSI 300
            'IC': '000905.SH',  # CSI 500
            'IM': '000852.SH',  # CSI 1000
        }
        for code, index_code in idx_map.items():
            data = None
            date_used = trade_date
            for back in range(0, 8):
                dt = (datetime.strptime(trade_date, '%Y%m%d') - timedelta(days=back)).strftime('%Y%m%d')
                data = _fallback_index_daily(pro, index_code, dt)
                if data is not None and (data.get('close') is not None or data.get('settle_return') is not None):
                    date_used = dt
                    used_dates.append(dt)
                    break
            result[code] = {
                'ts_code': None,
                'trade_date': date_used,
                'close': data['close'] if data else None,
                'settle': data['settle'] if data else None,
                'settle_return': data['settle_return'] if data else None,
                'source': 'index_daily',
            }

    # Set payload trade_date to the most recent date used across symbols
    payload_trade_date = trade_date
    try:
        if used_dates:
            payload_trade_date = max(used_dates)
        else:
            # Attempt calendar; if it yields today on a weekend, adjust to Friday
            td = None
            try:
                td = _latest_trade_date(pro)
            except Exception:
                td = None
            today_str = datetime.today().strftime('%Y%m%d')
            if td == today_str:
                payload_trade_date = _adjust_for_weekend(datetime.today())
            else:
                payload_trade_date = td or _adjust_for_weekend(datetime.today())
    except Exception:
        payload_trade_date = _adjust_for_weekend(datetime.today())
    payload = {
        'exchange': 'CFFEX',
        'trade_date': payload_trade_date,
        'data': result,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    main()
