# -*- coding: utf-8 -*-
"""Refresh RX383 inputs through 9 Nov, then rebuild the strategy note.

Skips the standalone 深挖 / 卖哪些品种 / 开平仓时点 Word files.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import report_type6_ops_missing_nav as ops  # noqa: E402

ops.ensure_db()

import _rx383_option_strategy_report as strat  # noqa: E402
import _rx383_pick_model as pick  # noqa: E402
import _rx383_timing_model as timing  # noqa: E402
import _rx383_hypothesis_record as hyp  # noqa: E402
import _rx383_combined_report as rep  # noqa: E402

strat.write_doc = lambda *a, **k: None
strat.charts = lambda res: {}
pick.write_doc = lambda *a, **k: None
timing.write_doc = lambda *a, **k: None

print("SUMMARY")
strat.main()
print("PICK")
pick.main()
print("TIMING")
timing.main()
print("HYPOTHESIS")
hyp.main()
print("REPORT")
rep.main()
print("DONE")
