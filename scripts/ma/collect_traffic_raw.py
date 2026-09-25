#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Parse nginx access logs + login history on the server into reports/_week_traffic_raw."""
from __future__ import annotations

import csv
import gzip
import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(os.environ.get("TRAFFIC_RAW_OUT", "/tmp/week_traffic_raw"))
NGINX_DIR = Path("/var/log/nginx")
TZ_NAME = "Asia/Shanghai"
TZ = timezone(timedelta(hours=8))
# Inclusive calendar dates in Asia/Shanghai, YYYY-MM-DD. Empty = no bound.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SINCE = os.environ.get("TRAFFIC_SINCE", "").strip()
UNTIL = os.environ.get("TRAFFIC_UNTIL", "").strip()
if SINCE and not _DATE_RE.match(SINCE):
    raise SystemExit(f"TRAFFIC_SINCE must be YYYY-MM-DD, got {SINCE!r}")
if UNTIL and not _DATE_RE.match(UNTIL):
    raise SystemExit(f"TRAFFIC_UNTIL must be YYYY-MM-DD, got {UNTIL!r}")

LOG_RE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] "(?P<req>[^"]*)" '
    r'(?P<status>\d+) (?P<bytes>\S+) "(?P<ref>[^"]*)" "(?P<ua>[^"]*)"'
)
STATIC_EXT_RE = re.compile(
    r"\.(?:js|css|png|jpe?g|gif|webp|ico|svg|woff2?|map|txt|xml)$", re.I
)
UUID_RE = re.compile(
    r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I
)
FUND_RE = re.compile(r"/[A-Z]{2,4}\d{2,6}(?:_[^/?#]+)?")
NUM_RE = re.compile(r"/\d{3,}\b")

PROBE_SUBSTR = (
    "/.env",
    "/.git",
    "/wp-",
    "/wordpress",
    "/phpmyadmin",
    "/xmlrpc",
    "/.aws",
    "/.docker",
    "/actuator",
    "/cgi-bin",
    "/vendor/",
    "/solr",
    "/manager/html",
    "/debug/default",
    "/console",
    "/boaform",
    "/hudson",
    "/jenkins",
    "/shell",
    "/eval-stdin",
    "/autodiscover",
    "/owa/",
    "/remote/login",
    "/sdk",
)
BOT_UA = (
    "censys",
    "bot",
    "spider",
    "crawler",
    "scan",
    "curl/",
    "python-requests",
    "httpie",
    "zgrab",
    "masscan",
    "nmap",
    "nuclei",
)


def parse_time(raw: str) -> datetime | None:
    try:
        return datetime.strptime(raw, "%d/%b/%Y:%H:%M:%S %z")
    except ValueError:
        return None


def window_bounds() -> tuple[datetime | None, datetime | None]:
    since = datetime.strptime(SINCE, "%Y-%m-%d").replace(tzinfo=TZ) if SINCE else None
    # UNTIL is inclusive calendar date.
    until = (
        datetime.strptime(UNTIL, "%Y-%m-%d").replace(tzinfo=TZ) + timedelta(days=1)
        if UNTIL
        else None
    )
    return since, until


def in_window(ts: datetime, since: datetime | None, until: datetime | None) -> bool:
    if since is not None and ts < since:
        return False
    if until is not None and ts >= until:
        return False
    return True


def collapse_path(path: str) -> str:
    p = path.split("?")[0] or "/"
    p = UUID_RE.sub("/:id", p)
    p = FUND_RE.sub("/:id", p)
    p = NUM_RE.sub("/:id", p)
    if len(p) > 160:
        p = p[:157] + "..."
    return p


def classify_kind(method: str, path: str, status: int, ua: str) -> str:
    m = (method or "").upper()
    raw_path = path or ""
    p = raw_path.split("?")[0] or "/"
    pl = p.lower()
    ua_l = (ua or "").lower()

    if m in {"PRI", "CONNECT"} or not m.isalpha() or "\\x" in raw_path:
        return "probe"
    if any(s in pl for s in PROBE_SUBSTR):
        return "probe"
    if pl.endswith((".php", ".asp", ".aspx", ".cgi", ".jsp")):
        return "probe"
    if pl in {"/ads.txt", "/sitemap.xml"}:
        return "probe"

    if pl.startswith("/api/presence"):
        return "heartbeat"
    if pl.startswith("/api/auth/me"):
        return "heartbeat"

    if pl.startswith("/_next/") or pl.startswith("/icon") or STATIC_EXT_RE.search(pl):
        return "static"

    if pl.startswith("/login") or pl.startswith("/api/auth"):
        return "login"

    if pl.startswith("/api/admin") or pl.startswith("/dashboard/admin"):
        return "admin"

    if pl.startswith("/ma/api/") or pl.startswith("/api/"):
        return "api"

    if pl.startswith("/ma/dashboard") or pl.startswith("/dashboard") or pl in {"/", "/ma", "/ma/"}:
        return "page"

    if status in {400, 404} and any(b in ua_l for b in BOT_UA):
        return "probe"
    return "other"


def classify_device(ua: str | None) -> str:
    s = (ua or "").lower()
    if any(b in s for b in BOT_UA):
        return "bot/script"
    if "iphone" in s or "android" in s or "mobile" in s or "huawei" in s:
        return "Mobile"
    if "edg/" in s:
        return "Edge"
    if "quark" in s:
        return "Quark"
    if "chrome" in s:
        return "Chrome"
    if "safari" in s:
        return "Safari"
    return "Other"


def classify_network(ip: str | None) -> str:
    ip = (ip or "").strip()
    if ip in {"::1", "127.0.0.1"}:
        return "Localhost (dev)"
    if ip.startswith("116.237.193."):
        return "Office A"
    if ip.startswith("116.234.199."):
        return "Network B"
    if ip.startswith("116.234.86."):
        return "Network C"
    if ip.startswith("111.187."):
        return "Network D"
    if ip.startswith("39.144."):
        return "Carrier 39.144"
    return "Other"


def iter_log_files():
    current = NGINX_DIR / "access.log"
    if current.exists():
        yield current
    rotated = NGINX_DIR / "access.log.1"
    if rotated.exists():
        yield rotated
    gz = sorted(NGINX_DIR.glob("access.log.*.gz"), key=lambda p: p.stat().st_mtime)
    yield from gz


def open_log(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("rt", encoding="utf-8", errors="replace")


def parse_request(req: str) -> tuple[str, str]:
    parts = req.split()
    if len(parts) >= 2 and parts[0].isalpha():
        return parts[0].upper(), parts[1]
    if parts and parts[0].isalpha():
        return parts[0].upper(), "/"
    return "INVALID", req[:80]


def write_csv(path: Path, headers: list[str], rows) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)


def fetch_sql(sql: str) -> list[list[str]]:
    env = os.environ.copy()
    env["PGCLIENTENCODING"] = "UTF8"
    proc = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", "market_data", "-At", "-F", "\t", "-c", sql],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    rows = []
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        rows.append(line.split("\t"))
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    since, until = window_bounds()

    daily = defaultdict(lambda: Counter())
    daily_bytes = Counter()
    daily_ips: dict[str, set[str]] = defaultdict(set)
    hourly = defaultdict(lambda: Counter())
    paths = Counter()
    pages = Counter()
    status_c = Counter()
    devices = Counter()
    networks = Counter()
    methods = Counter()
    ip_hits = defaultdict(lambda: Counter())
    ip_net = {}
    ip_paths: dict[str, Counter] = defaultdict(Counter)

    lines_scanned = 0
    hits = 0
    first_ts = None
    last_ts = None
    bytes_total = 0
    kind_total = Counter()

    for log_path in iter_log_files():
        with open_log(log_path) as fh:
            for line in fh:
                lines_scanned += 1
                m = LOG_RE.match(line.rstrip("\n"))
                if not m:
                    continue
                ts = parse_time(m.group("time"))
                if ts is None or not in_window(ts, since, until):
                    continue
                hits += 1
                if first_ts is None or ts < first_ts:
                    first_ts = ts
                if last_ts is None or ts > last_ts:
                    last_ts = ts
                method, raw_path = parse_request(m.group("req"))
                status = int(m.group("status"))
                try:
                    nbytes = int(m.group("bytes")) if m.group("bytes") != "-" else 0
                except ValueError:
                    nbytes = 0
                ip = m.group("ip")
                ua = m.group("ua")
                kind = classify_kind(method, raw_path, status, ua)
                path = collapse_path(raw_path)
                day = ts.strftime("%Y-%m-%d")
                hour = ts.hour

                daily[day][kind] += 1
                daily[day]["all"] += 1
                daily_bytes[day] += nbytes
                daily_ips[day].add(ip)
                hourly[(day, hour)][kind] += 1
                paths[path] += 1
                if kind == "page":
                    pages[path] += 1
                status_c[status] += 1
                devices[classify_device(ua)] += 1
                net = classify_network(ip)
                networks[net] += 1
                methods[method] += 1
                ip_hits[ip]["hits"] += 1
                ip_hits[ip][kind] += 1
                ip_net[ip] = net
                if kind in {"page", "api", "admin", "login"}:
                    ip_paths[ip][path] += 1
                bytes_total += nbytes
                kind_total[kind] += 1

    kinds = ["page", "api", "heartbeat", "static", "probe", "admin", "login", "other"]
    daily_rows = []
    for day in sorted(daily):
        row = daily[day]
        product = row["page"] + row["api"] + row["admin"] + row["login"]
        daily_rows.append(
            [
                day,
                row["all"],
                product,
                *(row[k] for k in kinds),
                daily_bytes[day],
                len(daily_ips[day]),
            ]
        )
    write_csv(
        OUT / "daily.csv",
        ["date", "all", "product", *kinds, "bytes", "unique_ips"],
        daily_rows,
    )

    hourly_rows = []
    for day, hour in sorted(hourly):
        row = hourly[(day, hour)]
        product = row["page"] + row["api"] + row["admin"] + row["login"]
        hourly_rows.append([day, hour, product, *(row[k] for k in kinds)])
    write_csv(
        OUT / "hourly.csv",
        ["date", "hour", "product", *kinds],
        hourly_rows,
    )

    write_csv(OUT / "top_paths.csv", ["path", "hits"], [[p, n] for p, n in paths.most_common(400)])
    write_csv(OUT / "top_pages.csv", ["path", "hits"], [[p, n] for p, n in pages.most_common(80)])
    write_csv(OUT / "status.csv", ["status", "hits"], sorted(status_c.items()))
    write_csv(OUT / "devices.csv", ["device", "hits"], devices.most_common())
    write_csv(OUT / "networks.csv", ["network", "hits"], networks.most_common())
    write_csv(OUT / "methods.csv", ["method", "hits"], methods.most_common())

    ip_rows = []
    for ip, c in sorted(ip_hits.items(), key=lambda kv: kv[1]["hits"], reverse=True)[:80]:
        ip_rows.append([ip, ip_net[ip], c["hits"], c["page"], c["api"]])
    write_csv(OUT / "ips.csv", ["ip", "network", "hits", "page", "api"], ip_rows)

    ip_path_rows = []
    ranked_ips = sorted(ip_paths, key=lambda ip: ip_hits[ip]["hits"], reverse=True)[:60]
    for ip in ranked_ips:
        for path, n in ip_paths[ip].most_common(40):
            ip_path_rows.append([ip, path, n])
    write_csv(OUT / "ip_paths.csv", ["ip", "path", "hits"], ip_path_rows)

    since_sql = f" AND logged_at >= TIMESTAMPTZ '{SINCE} 00:00:00+08'" if SINCE else ""
    until_sql = f" AND logged_at < TIMESTAMPTZ '{UNTIL} 00:00:00+08' + interval '1 day'" if UNTIL else ""
    login_rows = fetch_sql(
        f"""
        SELECT
          COALESCE(NULLIF(name, ''), identifier) AS who,
          to_char(logged_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') AS ts,
          CASE WHEN success THEN 't' ELSE 'f' END,
          COALESCE(fail_reason, ''),
          COALESCE(user_agent, ''),
          COALESCE(ip, '')
        FROM public.auth_login_history
        WHERE TRUE{since_sql}{until_sql}
        ORDER BY logged_at
        """
    )
    write_csv(
        OUT / "login.csv",
        ["who", "ts", "success", "fail_reason", "user_agent", "ip"],
        login_rows,
    )

    user_rows = fetch_sql(
        """
        SELECT name, role, to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS')
        FROM public.auth_users
        ORDER BY created_at
        """
    )
    write_csv(OUT / "users.csv", ["name", "role", "created"], user_rows)

    product_hits = kind_total["page"] + kind_total["api"] + kind_total["admin"] + kind_total["login"]
    summary = {
        "lines_scanned": lines_scanned,
        "hits_in_week": hits,
        "product_hits": product_hits,
        "page_hits": kind_total["page"],
        "unique_ips": len(ip_hits),
        "bytes_in_week": bytes_total,
        "kind": {k: int(kind_total[k]) for k in kinds},
        "first_ts": first_ts.isoformat() if first_ts else None,
        "last_ts": last_ts.isoformat() if last_ts else None,
        "timezone": TZ_NAME,
        "since": SINCE or None,
        "until": UNTIL or None,
        "http_source": "/var/log/nginx/access.log + rotated access.log.*",
        "login_source": "public.auth_login_history",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}  hits={hits}  scanned={lines_scanned}")
    print(f"Window {summary['first_ts']} → {summary['last_ts']}")


if __name__ == "__main__":
    main()
