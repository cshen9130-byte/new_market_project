#!/usr/bin/env python3
"""
export_pca_loadings.py
======================
Reads the trained pca.joblib and exports PC1/PC2 loadings for all 7 assets
to data/pca_loadings.json so the Next.js biplot API can serve them statically.

Run once (or whenever models are retrained):
  python3 scripts/ma/export_pca_loadings.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# ── locate project root ───────────────────────────────────────────────────────
script_dir   = Path(__file__).resolve().parent   # scripts/ma/
project_root = script_dir.parent.parent           # project root

# ── load .env ─────────────────────────────────────────────────────────────────
for base in [Path.cwd(), script_dir, project_root]:
    for fname in (".env.local", ".env"):
        f = base / fname
        if f.is_file():
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v

try:
    import joblib
    import numpy as np
except ImportError as e:
    print(f"Missing dependency: {e}. Run: pip install joblib numpy")
    sys.exit(1)

model_dir = Path(os.environ.get("MODEL_DIR") or str(project_root / "economy" / "models"))
pca_path  = model_dir / "pca.joblib"
if not pca_path.exists():
    print(f"Model not found: {pca_path}")
    sys.exit(1)

pca = joblib.load(pca_path)

# Column order MUST match the training order used in predict_market_cluster.py
COLS = [
    "510300.SH_ORIGINALUNIT",
    "510500.SH_ORIGINALUNIT",
    "511010.SH_ORIGINALUNIT",
    "511220.SH_ORIGINALUNIT",
    "511880.SH_ORIGINALUNIT",
    "518880.SH_ORIGINALUNIT",
    "NHCI.NH_CLOSE",
]
LABELS = {
    "510300.SH_ORIGINALUNIT": "沪深300ETF",
    "510500.SH_ORIGINALUNIT": "中证500ETF",
    "511010.SH_ORIGINALUNIT": "国债ETF",
    "511220.SH_ORIGINALUNIT": "公司债ETF",
    "511880.SH_ORIGINALUNIT": "货币基金ETF",
    "518880.SH_ORIGINALUNIT": "黄金ETF",
    "NHCI.NH_CLOSE":          "南华商品指数",
}

# pca.components_ shape: (n_components, n_features)
components = pca.components_   # rows = PCs, cols = features

loadings = []
for i, col in enumerate(COLS):
    loadings.append({
        "asset": col,
        "label": LABELS[col],
        "pc1":   float(components[0, i]),
        "pc2":   float(components[1, i]),
    })

explained = [float(v) for v in pca.explained_variance_ratio_[:2]]

out = {
    "loadings": loadings,
    "explained_variance": explained,
}

out_path = project_root / "data" / "pca_loadings.json"
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Written {len(loadings)} loadings → {out_path}")
print(f"PC1 explains {explained[0]*100:.1f}%, PC2 explains {explained[1]*100:.1f}%")
