# -*- coding: utf-8 -*-
"""Rebuild the strategy note. Hypothesis note and json inputs are already current."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import report_type6_ops_missing_nav as ops  # noqa: E402

ops.ensure_db()

import _rx383_combined_report as rep  # noqa: E402

print("REPORT")
rep.main()
print("DONE")
