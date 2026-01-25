import json
import os
import sys
from datetime import datetime
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


def main():
    _load_env_from_files()
    date_str = os.environ.get("SPOT_TRADE_DATE") or (sys.argv[1] if len(sys.argv) > 1 else None)
    if not date_str:
        # default to today formatted
        date_str = datetime.today().strftime("%Y-%m-%d")

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

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    loginresult = c.start(options, None, None)
    if loginresult.ErrorCode != 0:
        print(json.dumps({"error": f"login failed: {getattr(loginresult, 'ErrorMsg', 'unknown')}"}))
        sys.exit(3)

    try:
        codes = ["000016.SH", "000300.SH", "000905.SH", "000852.SH"]
        alias = {"000016.SH": "IH", "000300.SH": "IF", "000905.SH": "IC", "000852.SH": "IM"}
        code_str = ",".join(codes)
        data = c.css(code_str, "CLOSE", f"TradeDate={date_str}")
        if data.ErrorCode != 0:
            # Print debug info to stderr for troubleshooting
            try:
                print(f"[spot-css] error: {data.ErrorCode} trade_date={date_str} codes={code_str}", file=sys.stderr)
            except Exception:
                pass
            print(json.dumps({"error": f"css error: {data.ErrorCode}"}))
            sys.exit(4)
        # Parse CLOSE values
        result = {}
        DD = getattr(data, "Data", None) or getattr(data, "data", None)
        # EmQuant css often returns Data as a dict keyed by code: {'000300.SH': [4702.4966]}
        if isinstance(DD, dict) and any(k in DD for k in codes):
            try:
                print(f"[spot-css] Data keys={list(DD.keys())}", file=sys.stderr)
            except Exception:
                pass
            for code in codes:
                raw = DD.get(code)
                val = None
                try:
                    if isinstance(raw, (list, tuple)) and raw:
                        val = float(raw[0])
                    elif raw is not None:
                        val = float(raw)
                except Exception:
                    val = None
                key = alias.get(code, code)
                if val is not None:
                    result[key] = {"code": code, "close": val}
        else:
            # Fallback to field-oriented parsing where Data might be {'CLOSE': [..]}
            try:
                values = None
                if isinstance(DD, dict):
                    values = DD.get("CLOSE")
                elif isinstance(DD, (list, tuple)):
                    values = DD[0] if DD else []
                else:
                    values = DD
                vlist = list(values) if values is not None else []
            except Exception:
                vlist = []
            try:
                print(f"[spot-css] trade_date={date_str} codes={code_str} values={vlist}", file=sys.stderr)
            except Exception:
                pass
            for i, code in enumerate(getattr(data, "Codes", codes) or codes):
                try:
                    val = float(vlist[i]) if i < len(vlist) else None
                except Exception:
                    val = None
                key = alias.get(code, code)
                if val is not None:
                    result[key] = {"code": code, "close": val}
        # Debug: print parsed result to stderr
        try:
            print(f"[spot-css] parsed={result}", file=sys.stderr)
        except Exception:
            pass
        print(json.dumps({"trade_date": date_str, "data": result}, ensure_ascii=False))
    finally:
        try:
            c.stop()
        except Exception:
            pass


if __name__ == "__main__":
    main()
