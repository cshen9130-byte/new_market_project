#!/bin/bash
set -euo pipefail
echo "=== tools ==="
which pdftoppm pdftocairo gs mutool convert magick python3 2>/dev/null || true
pdf="/root/market_dashboard_storage/fund-elements/jobs/1786945219956_f191d7888122e1ed.pdf"
ls -l "$pdf"
python3 - <<'PY'
from pathlib import Path
import re
p = Path("/root/market_dashboard_storage/fund-elements/jobs/1786945219956_f191d7888122e1ed.pdf").read_bytes()
print("header", p[:16])
s = p.decode("latin1")
for token in ["JBIG", "JPX", "DCTDecode", "FlateDecode", "/Image", "/CCITT", "JPXDecode", "JBIG2Decode"]:
    print(token, token in s)
print("filters", re.findall(rb"/Filter\s*/\w+", p)[:30])
print("subtypes", re.findall(rb"/Subtype\s*/\w+", p)[:30])
print("media", re.findall(rb"/MediaBox\s*\[[^\]]+\]", p)[:10])
print("rotate", re.findall(rb"/Rotate\s+\d+", p)[:10])
PY
if command -v pdftoppm >/dev/null 2>&1; then
  mkdir -p /tmp/qidun_ocr
  pdftoppm -png -r 150 "$pdf" /tmp/qidun_ocr/page
  ls -l /tmp/qidun_ocr
fi
