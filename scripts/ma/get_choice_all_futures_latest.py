import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Ensure UTF-8 stdout/stderr on Windows to avoid mojibake
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


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


def log_callback(msg):
    try:
        if isinstance(msg, bytes):
            msg_str = msg.decode('utf-8', errors='ignore').strip()
        else:
            msg_str = str(msg)
        if 'heartbeat' in msg_str.lower():
            return 0
    except Exception:
        pass
    return 0


def _to_float(v):
    try:
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, bytes):
            v = v.decode('utf-8', errors='ignore').strip()
        s = str(v).strip()
        # Remove thousands separators and percent signs
        s = s.replace(',', '').replace('%', '')
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
        s = str(v)
        return s
    except Exception:
        return None


def normalize_css(data_obj):
    out = []
    try:
        Codes = getattr(data_obj, 'Codes', None)
        Data = getattr(data_obj, 'Data', None)
        Fields = getattr(data_obj, 'Fields', None) or getattr(data_obj, 'Field', None)
        if not Codes or Data is None:
            return out
        # Three shapes:
        # 1) dict keyed by field names -> lists
        # 2) list-of-lists with Fields naming
        # 3) dict keyed by codes -> [NAME, CLEARDIFFERRANGE, AMOUNT]
        def pick_from_dict(dic, key):
            return dic.get(key) or dic.get(key.lower()) if isinstance(dic, dict) else None
        # Case 3: dict keyed by codes
        if isinstance(Data, dict) and any((code in Data) for code in list(Codes)):
            codes_list = list(Codes)
            for code in codes_list:
                vals = Data.get(code)
                name = None; ret = None; amt = None
                if isinstance(vals, (list, tuple)):
                    name = _to_str(vals[0]) if len(vals) > 0 else None
                    ret = _to_float(vals[1]) if len(vals) > 1 else None
                    amt = _to_float(vals[2]) if len(vals) > 2 else None
                out.append({
                    'code': code,
                    'name': name,
                    'return_pct': ret,
                    'amount': amt,
                })
            return out
        # Case 1: dict keyed by field names
        names = None; rets = None; amts = None
        if isinstance(Data, dict):
            names = pick_from_dict(Data, 'NAME')
            rets = pick_from_dict(Data, 'CLEARDIFFERRANGE')
            amts = pick_from_dict(Data, 'AMOUNT')
        # Case 2: list-of-lists with Fields
        elif isinstance(Data, (list, tuple)) and isinstance(Fields, (list, tuple)):
            try:
                flds = [(_to_str(f) or '').upper() for f in Fields]
                def get_series(field_name):
                    try:
                        idx = flds.index(field_name)
                        series = Data[idx] if idx >= 0 and idx < len(Data) else None
                        return list(series) if series is not None else None
                    except Exception:
                        return None
                names = get_series('NAME')
                rets = get_series('CLEARDIFFERRANGE')
                amts = get_series('AMOUNT')
            except Exception:
                names = None; rets = None; amts = None
        # Build output for cases 1/2
        for i, code in enumerate(list(Codes)):
            name = _to_str(names[i]) if isinstance(names, (list, tuple)) and i < len(names) else None
            ret = _to_float(rets[i]) if isinstance(rets, (list, tuple)) and i < len(rets) else None
            amt = _to_float(amts[i]) if isinstance(amts, (list, tuple)) and i < len(amts) else None
            out.append({
                'code': code,
                'name': name,
                'return_pct': ret,
                'amount': amt,
            })
    except Exception:
        pass
    return out


def main():
    _load_env_from_files()

    try:
        import EmQuantAPI as Emq  # type: ignore
        c = Emq.c
    except Exception as e:
        print(json.dumps({"error": f"EmQuantAPI import failed: {e}"}))
        sys.exit(1)

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD in environment"}))
        sys.exit(2)

    trade_date = os.environ.get("CHOICE_TRADE_DATE") or os.environ.get("SPOT_TRADE_DATE") or datetime.today().strftime("%Y-%m-%d")
    if len(sys.argv) >= 2:
        trade_date = sys.argv[1]

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=1"
    loginresult = c.start(options, log_callback, None)
    if loginresult.ErrorCode != 0:
        print(json.dumps({"error": f"login failed: {getattr(loginresult, 'ErrorMsg', 'unknown')}"}))
        sys.exit(3)

    codes = "A0.DCE,AD0.SHF,AG0.SHF,AL0.SHF,AO0.SHF,AP0.CZC,AU0.SHF,B0.DCE,BB0.DCE,BCM.INE,BR0.SHF,BU0.SHF,BZ0.DCE,C0.DCE,CF0.CZC,CJ0.CZC,CS0.DCE,CU0.SHF,CY0.CZC,EB0.DCE,ECM.INE,EG0.DCE,FB0.DCE,FG0.CZC,FU0.SHF,HC0.SHF,I0.DCE,J0.DCE,JD0.DCE,JM0.DCE,JR0.CZC,L0.DCE,LCM.GFE,LF0.DCE,LG0.DCE,LH0.DCE,LR0.CZC,LUM.INE,M0.DCE,MA0.CZC,NI0.SHF,NRM.INE,OI0.CZC,OP0.SHF,P0.DCE,PB0.SHF,PDM.GFE,PF0.CZC,PG0.DCE,PK0.CZC,PL0.CZC,PM0.CZC,PP0.DCE,PPF0.DCE,PR0.CZC,PSM.GFE,PTM.GFE,PX0.CZC,RB0.SHF,RI0.CZC,RM0.CZC,RR0.DCE,RS0.CZC,RU0.SHF,SA0.CZC,SCM.INE,SF0.CZC,SH0.CZC,SIM.GFE,SM0.CZC,SN0.SHF,SP0.SHF,SR0.CZC,SS0.SHF,TA0.CZC,UR0.CZC,V0.DCE,VF0.DCE,WH0.CZC,WR0.SHF,Y0.DCE,ZC0.CZC,ZN0.SHF"
    fields = "NAME,CLEARDIFFERRANGE,AMOUNT"
    opts = f"TradeDate={trade_date}"
    out = {"trade_date": trade_date, "data": []}
    try:
        data = c.css(codes, fields, opts)
        if getattr(data, "ErrorCode", 0) != 0:
            out["error"] = f"css error: {getattr(data, 'ErrorCode', 'unknown')}"
        else:
            parsed = normalize_css(data)
            out["data"] = parsed
            try:
                has_nonzero = any((isinstance(it.get('amount'), (int, float)) and (it.get('amount') or 0) > 0) for it in parsed)
                if not has_nonzero:
                    data2 = c.css(codes, "TURNOVER,VALUE", opts)
                    if getattr(data2, "ErrorCode", 0) == 0:
                        D2 = getattr(data2, 'Data', None)
                        F2 = getattr(data2, 'Fields', None) or getattr(data2, 'Field', None)
                        def get_series_any(D, F, name):
                            if isinstance(D, dict):
                                return D.get(name) or D.get(name.lower())
                            if isinstance(D, (list, tuple)) and isinstance(F, (list, tuple)):
                                try:
                                    flds = [(_to_str(f) or '').upper() for f in F]
                                    idx = flds.index(name)
                                    return list(D[idx]) if idx >= 0 and idx < len(D) else None
                                except Exception:
                                    return None
                            return None
                        turnover = get_series_any(D2, F2, 'TURNOVER') or []
                        value = get_series_any(D2, F2, 'VALUE') or []
                        for i in range(len(parsed)):
                            if parsed[i]['amount'] is None or parsed[i]['amount'] == 0:
                                tv = _to_float(turnover[i]) if i < len(turnover) else None
                                vv = _to_float(value[i]) if i < len(value) else None
                                parsed[i]['amount'] = tv if (tv is not None and tv > 0) else (vv if (vv is not None and vv > 0) else parsed[i]['amount'])
                has_nonzero = any((isinstance(it.get('amount'), (int, float)) and (it.get('amount') or 0) > 0) for it in parsed)
                if not has_nonzero:
                    data3 = c.css(codes, "CLOSE,VOLUME", opts)
                    if getattr(data3, "ErrorCode", 0) == 0:
                        D3 = getattr(data3, 'Data', None)
                        F3 = getattr(data3, 'Fields', None) or getattr(data3, 'Field', None)
                        close = None; volume = None
                        if isinstance(D3, dict):
                            close = D3.get('CLOSE') or D3.get('close') or []
                            volume = D3.get('VOLUME') or D3.get('volume') or []
                        elif isinstance(D3, (list, tuple)) and isinstance(F3, (list, tuple)):
                            flds = [(_to_str(f) or '').upper() for f in F3]
                            def series(D, idx):
                                try:
                                    return list(D[idx])
                                except Exception:
                                    return []
                            try:
                                ci = flds.index('CLOSE'); vi = flds.index('VOLUME')
                                close = series(D3, ci); volume = series(D3, vi)
                            except Exception:
                                close = []; volume = []
                        for i in range(len(parsed)):
                            if parsed[i]['amount'] is None or parsed[i]['amount'] == 0:
                                cv = _to_float(close[i]) if i < len(close) else None
                                vv = _to_float(volume[i]) if i < len(volume) else None
                                if cv is not None and vv is not None and cv > 0 and vv > 0:
                                    parsed[i]['amount'] = cv * vv
            except Exception:
                pass
            out["data"] = parsed
            try:
                if os.environ.get("CHOICE_DEBUG") == "1":
                    Codes = list(getattr(data, 'Codes', []) or [])
                    Data = getattr(data, 'Data', {}) or {}
                    Fields = getattr(data, 'Fields', None) or getattr(data, 'Field', None)
                    def to_list_safe(v):
                        try:
                            return list(v)
                        except Exception:
                            return []
                    raw_fields = {}
                    # Support three shapes in debug extraction
                    if isinstance(Data, dict) and any((code in Data) for code in Codes):
                        # Dict keyed by codes -> [NAME, RET, AMT]
                        name_list = []
                        ret_list = []
                        amt_list = []
                        for code in Codes:
                            vals = Data.get(code)
                            if isinstance(vals, (list, tuple)):
                                name_list.append(vals[0] if len(vals) > 0 else None)
                                ret_list.append(vals[1] if len(vals) > 1 else None)
                                amt_list.append(vals[2] if len(vals) > 2 else None)
                            else:
                                name_list.append(None); ret_list.append(None); amt_list.append(None)
                        raw_fields['NAME'] = name_list
                        raw_fields['CLEARDIFFERRANGE'] = ret_list
                        raw_fields['AMOUNT'] = amt_list
                    else:
                        for k in ("NAME", "CLEARDIFFERRANGE", "AMOUNT"):
                            try:
                                arr = None
                                if isinstance(Data, dict):
                                    arr = Data.get(k) or Data.get(k.lower())
                                if arr is None and isinstance(Data, (list, tuple)) and isinstance(Fields, (list, tuple)):
                                    names = [(_to_str(f) or '').upper() for f in Fields]
                                    try:
                                        idx = names.index(k)
                                        arr = Data[idx] if idx >= 0 and idx < len(Data) else None
                                    except Exception:
                                        arr = None
                                raw_fields[k] = to_list_safe(arr or [])
                            except Exception:
                                raw_fields[k] = []
                    dump_str = None
                    try:
                        dump_str = str(data)
                    except Exception:
                        dump_str = None
                    out["raw"] = {"codes": Codes, "fields": raw_fields, "dump": dump_str}
            except Exception:
                pass
    finally:
        try:
            c.stop()
        except Exception:
            pass

    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
