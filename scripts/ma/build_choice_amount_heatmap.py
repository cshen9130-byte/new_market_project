import json
import os
import sys
from pathlib import Path
from datetime import datetime

# Ensure UTF-8 stdout/stderr on Windows
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# Codes list from dashboard
CODES = "A0.DCE,AD0.SHF,AG0.SHF,AL0.SHF,AO0.SHF,AP0.CZC,AU0.SHF,B0.DCE,BB0.DCE,BCM.INE,BR0.SHF,BU0.SHF,BZ0.DCE,C0.DCE,CF0.CZC,CJ0.CZC,CS0.DCE,CU0.SHF,CY0.CZC,EB0.DCE,ECM.INE,EG0.DCE,FB0.DCE,FG0.CZC,FU0.SHF,HC0.SHF,I0.DCE,J0.DCE,JD0.DCE,JM0.DCE,JR0.CZC,L0.DCE,LCM.GFE,LF0.DCE,LG0.DCE,LH0.DCE,LR0.CZC,LUM.INE,M0.DCE,MA0.CZC,NI0.SHF,NRM.INE,OI0.CZC,OP0.SHF,P0.DCE,PB0.SHF,PDM.GFE,PF0.CZC,PG0.DCE,PK0.CZC,PL0.CZC,PM0.CZC,PP0.DCE,PPF0.DCE,PR0.CZC,PSM.GFE,PTM.GFE,PX0.CZC,RB0.SHF,RI0.CZC,RM0.CZC,RR0.DCE,RS0.CZC,RU0.SHF,SA0.CZC,SCM.INE,SF0.CZC,SH0.CZC,SIM.GFE,SM0.CZC,SN0.SHF,SP0.SHF,SR0.CZC,SS0.SHF,TA0.CZC,UR0.CZC,V0.DCE,VF0.DCE,WH0.CZC,WR0.SHF,Y0.DCE,ZC0.CZC,ZN0.SHF"

SECTOR_RULES = {
    # 农产
    "农产": {"C", "CS", "WH", "PM", "RR", "RI", "JR", "LR", "A", "B", "M", "Y", "RM", "OI", "RS", "PK", "P", "SR", "CF", "CY", "AP", "CJ", "LH", "JD", "LG", "SP", "OP"},
    # 贵金属
    "贵金属": {"AU", "AG", "PT", "PD"},
    # 有色
    "有色": {"CU", "BC", "AL", "AO", "AD", "ZN", "PB", "NI", "SN"},
    # 新能源
    "新能源": {"LC", "PS", "SI"},
    # 黑色
    "黑色": {"I", "SF", "SM", "RB", "HC", "SS", "WR", "JM", "J", "ZC", "FG", "BB", "FB"},
    # 能源化工
    "能源化工": {"SC", "FU", "LU", "PG", "BU", "TA", "EG", "PF", "PR", "PL", "PP", "L", "BZ", "PX", "EB", "RU", "BR", "NR", "SA", "SH", "V", "UR", "MA"},
    # 航运
    "航运": {"EC"},
    # 股指
    "股指": {"IH", "IF", "IC", "IM", "MO"},
    # 国债
    "国债": {"TS", "TF", "T", "TL"},
}


def _load_env_from_files():
    for base in [Path.cwd(), Path(__file__).resolve().parent, Path(__file__).resolve().parent.parent]:
        for fname in (".env", ".env.local"):
            f = base / fname
            if f.exists():
                for line in f.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    if os.environ.get(k) is None:
                        os.environ[k] = v.strip().strip('"').strip("'")


def _to_float(v):
    try:
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, bytes):
            v = v.decode('utf-8', errors='ignore')
        s = str(v).strip()
        if s == '' or s.lower() in ('none', 'nan'):
            return None
        return float(s)
    except Exception:
        return None


def _to_str(v):
    try:
        if v is None:
            return None
        if isinstance(v, bytes):
            return v.decode('utf-8', errors='ignore').strip()
        return str(v)
    except Exception:
        return None


def product_prefix(code: str) -> str:
    head = (code.split(".")[0] or "").upper()
    # Strip trailing digits
    p = ''.join([ch for ch in head if not ch.isdigit()])
    # Remove common single-letter suffixes (M/F/X) only when length > 2
    if len(p) > 2 and p[-1] in {"M", "F", "X"}:
        p = p[:-1]
    return p

def categorize(code: str) -> str:
    p = product_prefix(code)
    for sector, codes in SECTOR_RULES.items():
        if p in codes:
            return sector
    return "其他"


def main():
    _load_env_from_files()
    try:
        import EmQuantAPI as Emq
        c = Emq.c
    except Exception as e:
        print(json.dumps({"error": f"EmQuantAPI import failed: {e}"}))
        sys.exit(1)

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD"}))
        sys.exit(2)

    trade_date = os.environ.get("CHOICE_TRADE_DATE") or (sys.argv[1] if len(sys.argv) >= 2 else datetime.today().strftime("%Y-%m-%d"))
    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=1"
    login = c.start(options, None, None)
    if login.ErrorCode != 0:
        print(json.dumps({"error": f"login failed: {getattr(login,'ErrorMsg','unknown')}"}))
        sys.exit(3)

    fields = "NAME,CLEARDIFFERRANGE,AMOUNT"
    opts = f"TradeDate={trade_date}"
    data = c.css(CODES, fields, opts)
    if getattr(data, 'ErrorCode', 0) != 0:
        print(json.dumps({"error": f"css error: {getattr(data,'ErrorCode','unknown')}"}))
        sys.exit(4)

    # Normalize supporting three shapes: dict-of-fields, list-of-lists, dict keyed by codes -> [NAME, RET, AMT]
    Codes = list(getattr(data, 'Codes', []) or [])
    Data = getattr(data, 'Data', {}) or {}
    Fields = getattr(data, 'Fields', None) or getattr(data, 'Field', None)
    def pick(dic, key):
        return dic.get(key) or dic.get(key.lower()) if isinstance(dic, dict) else None
    items = []
    if isinstance(Data, dict) and any((code in Data) for code in Codes):
        for code in Codes:
            vals = Data.get(code)
            name = _to_str(vals[0]) if isinstance(vals, (list, tuple)) and len(vals) > 0 else None
            ret = _to_float(vals[1]) if isinstance(vals, (list, tuple)) and len(vals) > 1 else None
            amt = _to_float(vals[2]) if isinstance(vals, (list, tuple)) and len(vals) > 2 else None
            items.append({'code': code, 'name': name, 'return_pct': ret, 'amount': amt})
    else:
        names = []; rets = []; amts = []
        if isinstance(Data, dict):
            names = pick(Data, 'NAME') or []
            rets = pick(Data, 'CLEARDIFFERRANGE') or []
            amts = pick(Data, 'AMOUNT') or []
        elif isinstance(Data, (list, tuple)) and isinstance(Fields, (list, tuple)):
            flds = [(_to_str(f) or '').upper() for f in Fields]
            def series_by_name(name: str):
                try:
                    idx = flds.index(name)
                    return list(Data[idx]) if idx >= 0 and idx < len(Data) else []
                except Exception:
                    return []
            names = series_by_name('NAME')
            rets = series_by_name('CLEARDIFFERRANGE')
            amts = series_by_name('AMOUNT')
        for i, code in enumerate(Codes):
            items.append({
                'code': code,
                'name': _to_str(names[i]) if i < len(names) else None,
                'return_pct': _to_float(rets[i]) if i < len(rets) else None,
                'amount': _to_float(amts[i]) if i < len(amts) else None,
            })

    # Fallbacks for zero amounts
    if not any((isinstance(it['amount'], (int,float)) and (it['amount'] or 0) > 0) for it in items):
        data2 = c.css(CODES, "TURNOVER,VALUE", opts)
        if getattr(data2, 'ErrorCode', 0) == 0:
            D2 = getattr(data2, 'Data', {}) or {}
            F2 = getattr(data2, 'Fields', None) or getattr(data2, 'Field', None)
            def series_any(D, F, name):
                if isinstance(D, dict):
                    return pick(D, name) or []
                if isinstance(D, (list, tuple)) and isinstance(F, (list, tuple)):
                    try:
                        f2 = [(_to_str(f) or '').upper() for f in F]
                        idx = f2.index(name)
                        return list(D[idx]) if idx >= 0 and idx < len(D) else []
                    except Exception:
                        return []
                return []
            to = series_any(D2, F2, 'TURNOVER')
            val = series_any(D2, F2, 'VALUE')
            for i in range(len(items)):
                tv = _to_float(to[i]) if i < len(to) else None
                vv = _to_float(val[i]) if i < len(val) else None
                if (items[i]['amount'] is None or items[i]['amount'] == 0) and (tv is not None and tv > 0):
                    items[i]['amount'] = tv
                if (items[i]['amount'] is None or items[i]['amount'] == 0) and (vv is not None and vv > 0):
                    items[i]['amount'] = vv
        # Approximate CLOSE*VOLUME if still zero
        if not any((isinstance(it['amount'], (int,float)) and (it['amount'] or 0) > 0) for it in items):
            data3 = c.css(CODES, "CLOSE,VOLUME", opts)
            if getattr(data3, 'ErrorCode', 0) == 0:
                D3 = getattr(data3, 'Data', {}) or {}
                F3 = getattr(data3, 'Fields', None) or getattr(data3, 'Field', None)
                def series_any(D, F, name):
                    if isinstance(D, dict):
                        return pick(D, name) or []
                    if isinstance(D, (list, tuple)) and isinstance(F, (list, tuple)):
                        try:
                            f3 = [(_to_str(f) or '').upper() for f in F]
                            idx = f3.index(name)
                            return list(D[idx]) if idx >= 0 and idx < len(D) else []
                        except Exception:
                            return []
                    return []
                close = series_any(D3, F3, 'CLOSE')
                vol = series_any(D3, F3, 'VOLUME')
                for i in range(len(items)):
                    cv = _to_float(close[i]) if i < len(close) else None
                    vv = _to_float(vol[i]) if i < len(vol) else None
                    if (items[i]['amount'] is None or items[i]['amount'] == 0) and cv and vv and cv > 0 and vv > 0:
                        items[i]['amount'] = cv * vv

    # Group
    groups = {}
    total = 0.0
    for it in items:
        cat = categorize(it['code'])
        amt = it['amount'] if isinstance(it['amount'], (int,float)) else 0.0
        total += amt
        display = it['name'] if it['name'] else it['code']
        groups.setdefault(cat, { 'name': cat, 'children': [] })
        groups[cat]['children'].append({ 'name': display, 'value': amt, 'ret': it['return_pct'] })

    payload = { 'trade_date': trade_date, 'total_amount': total, 'data': list(groups.values()) }
    # Write to data/commodity_amount_heatmap.json
    out_dir = Path.cwd() / 'data'
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / 'commodity_amount_heatmap.json'
    out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({ 'ok': True, 'trade_date': trade_date, 'total_amount': total }, ensure_ascii=False))

    try:
        c.stop()
    except Exception:
        pass


if __name__ == '__main__':
    main()
