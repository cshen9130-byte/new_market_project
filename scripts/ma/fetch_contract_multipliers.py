"""
Fetch futures contract multipliers from OpenCTP API.
Saves { product_code -> volume_multiple } to data/contract_multipliers.json
e.g. { "AU": 1000.0, "LC": 1.0, "AL": 5.0, ... }

Run manually or add to nightly_etl.py:
    python scripts/ma/fetch_contract_multipliers.py
"""

import json
import requests
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent.parent / "data" / "contract_multipliers.json"

# OpenCTP returns both futures and options; try all known type values
URLS = [
    "http://dict.openctp.cn/instruments?types=future",
    "http://dict.openctp.cn/instruments?types=futures",
    "http://dict.openctp.cn/instruments?types=option",
    "http://dict.openctp.cn/instruments",          # no filter — broadest
]


def fetch_multipliers() -> dict[str, float]:
    result: dict[str, float] = {}
    seen_url = False

    for url in URLS:
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            payload = resp.json()
            items = payload.get("data", [])
            if not items:
                print(f"  {url} → empty data, skipping")
                continue
            seen_url = True
            added = 0
            for item in items:
                pid = str(item.get("ProductID", "")).strip().upper()
                vm  = item.get("VolumeMultiple")
                if not pid:
                    continue
                try:
                    vm_f = float(vm) if vm is not None else 0.0
                except Exception:
                    vm_f = 0.0
                if pid not in result and vm_f > 0:
                    result[pid] = vm_f
                    added += 1
            print(f"  {url} → {len(items)} instruments, {added} new product mappings")
        except Exception as e:
            print(f"  {url} → FAILED: {e}")

    if not seen_url:
        print("WARNING: all URLs failed, no data written")
        return result

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(f"\nSaved {len(result)} product multipliers to {OUTPUT}")
    return result


if __name__ == "__main__":
    fetch_multipliers()
