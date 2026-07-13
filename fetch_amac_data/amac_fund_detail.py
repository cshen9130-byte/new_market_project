#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Parse AMAC private fund detail HTML pages."""

from __future__ import annotations

import re


def parse_fund_type(html: str) -> str | None:
    """Extract 基金类型 from an AMAC fund disclosure detail page."""
    if not html:
        return None

    patterns = (
        r"基金类型</td>\s*<td[^>]*>\s*([^<\s][^<]*?)\s*</td>",
        r"基金类型\s*</td>\s*<td[^>]*>\s*([^<]+?)\s*</td>",
        r"基金类型[：:]\s*</td>\s*<td[^>]*>\s*([^<]+?)\s*</td>",
    )
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if match:
            value = re.sub(r"\s+", " ", match.group(1)).strip()
            if value and value != "-":
                return value
    return None
