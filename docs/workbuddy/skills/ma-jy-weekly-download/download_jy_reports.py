# -*- coding: utf-8 -*-
"""Download JY weekly-review workbooks without an interactive agent.

Reads jy-weekly.config.json beside this file (or the path in argv[1]).
The API key stays in the key file named there, never in this script.

Exit 0 when every requested workbook is saved or already present.
Exit 1 when any workbook fails. Details go to stderr.
"""
import base64
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

POLL_INTERVAL = 5
MAX_WAIT = 240
LABEL = {"equity": "股票", "futures": "期货", "public": "公募指增", "external": "外部私募"}


def load_config():
    here = os.path.dirname(os.path.abspath(__file__))
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "jy-weekly.config.json")
    with open(path, encoding="utf-8") as handle:
        config = json.load(handle)
    config["_dir"] = os.path.dirname(os.path.abspath(path))
    return config


def read_key(config):
    env = os.environ.get("FUND_DATA_API_KEY", "").strip()
    if env:
        return env
    key_file = config.get("key_file") or "fund-data.key"
    if not os.path.isabs(key_file):
        key_file = os.path.join(config["_dir"], key_file)
    with open(key_file, encoding="utf-8") as handle:
        key = handle.read().strip()
    if not key:
        raise RuntimeError("密钥文件是空的")
    return key


def parse_body(raw, headers):
    ctype = (headers.get("Content-Type") or "").lower()
    if "text/event-stream" in ctype:
        events = []
        for block in raw.decode("utf-8", "replace").split("\n\n"):
            for line in block.splitlines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload and payload != "[DONE]":
                    try:
                        events.append(json.loads(payload))
                    except json.JSONDecodeError:
                        pass
        return events
    if not raw.strip():
        return []
    return [json.loads(raw.decode("utf-8"))]


class Mcp:
    def __init__(self, url, api_key):
        self.url = url
        self.api_key = api_key
        self.session_id = None
        self.ssl_ctx = ssl.create_default_context()
        self.ssl_ctx.check_hostname = False
        self.ssl_ctx.verify_mode = ssl.CERT_NONE
        self.rpc_id = 1

    def post(self, method, params=None, notify=False):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self.rpc_id += 1
            body["id"] = self.rpc_id
        req = urllib.request.Request(
            self.url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "x-api-key": self.api_key,
            },
            method="POST",
        )
        if self.session_id:
            req.add_header("mcp-session-id", self.session_id)
        try:
            with urllib.request.urlopen(req, timeout=120, context=self.ssl_ctx) as resp:
                sid = resp.headers.get("mcp-session-id")
                if sid:
                    self.session_id = sid
                return parse_body(resp.read(), resp.headers)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from None

    def initialize(self):
        events = self.post(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "jy-weekly-download", "version": "1.0"},
            },
        )
        for event in events:
            if "error" in event:
                raise RuntimeError(f"initialize 失败: {event['error']}")
        self.post("notifications/initialized", notify=True)

    def weekly_review(self, arguments):
        events = self.post("tools/call", {"name": "weekly_review", "arguments": arguments})
        for event in events:
            if "error" in event:
                raise RuntimeError(f"weekly_review 失败: {event['error']}")
            result = event.get("result") or {}
            texts = [
                item.get("text", "")
                for item in result.get("content", [])
                if item.get("type") == "text"
            ]
            if not texts:
                continue
            try:
                return json.loads(texts[0])
            except json.JSONDecodeError:
                return {"raw": texts[0][:200]}
        return None


def report_date(data):
    file_name = data.get("file_name") or ""
    match = re.search(r"(\d{2})\.(\d{2})\.(\d{2})", file_name)
    if match:
        return "20" + "".join(match.groups())
    week_end = ((data.get("analysis") or {}).get("week_end") or "").replace("-", "")
    return week_end or "unknown"


def run_one(client, config, variant):
    started = time.time()
    pools = config.get("pools") or "jy"
    data = client.weekly_review({"report": "run", "variant": variant, "pools": pools})
    if not data or "job_id" not in data:
        preview = json.dumps(data, ensure_ascii=False)[:200] if data else "无返回"
        raise RuntimeError(f"未拿到 job_id: {preview}")
    job_id = data["job_id"]
    deadline = time.time() + MAX_WAIT
    while time.time() < deadline:
        data = client.weekly_review({"job_id": job_id, "file": "1"})
        status = (data or {}).get("status")
        if status == "done":
            break
        if status == "error":
            raise RuntimeError(f"任务 error: {(data or {}).get('error')}")
        time.sleep(POLL_INTERVAL)
    else:
        raise RuntimeError(f"轮询超时（{MAX_WAIT}s）")
    encoded = data.get("content_base64")
    if not encoded:
        raise RuntimeError("done 但缺少 content_base64")
    label = LABEL.get(variant, variant)
    out_dir = config["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"JY跟踪池-周度回顾({label})-{report_date(data)}.xlsx")
    if os.path.exists(out_path):
        print(f"[skip] {variant} path={out_path} bytes={os.path.getsize(out_path)} action=skip")
        return
    with open(out_path, "wb") as handle:
        handle.write(base64.b64decode(encoded))
    elapsed = time.time() - started
    print(f"[ok] {variant} path={out_path} bytes={os.path.getsize(out_path)} action=new elapsed={elapsed:.0f}s")


def main():
    config = load_config()
    variants = config.get("variants") or ["equity", "futures"]
    client = Mcp(config["mcp_url"], read_key(config))
    client.initialize()
    failures = []
    for variant in variants:
        try:
            run_one(client, config, variant)
        except Exception as exc:
            failures.append(f"{variant}: {exc}")
            print(f"[fail] {variant}: {exc}", file=sys.stderr)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
