# -*- coding: utf-8 -*-
"""Download the latest MOM briefing file. No interactive agent.

Reads jy-weekly-style config beside this file, but the key is the MOM data key.
Exit 0 when the file is saved or already present. Exit 1 on failure.
"""
import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request


def load_config():
    here = os.path.dirname(os.path.abspath(__file__))
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "mom-briefing.config.json")
    with open(path, encoding="utf-8") as handle:
        config = json.load(handle)
    config["_dir"] = os.path.dirname(os.path.abspath(path))
    return config


def read_key(config):
    env = os.environ.get("MOM_DATA_API_KEY", "").strip()
    if env:
        return env
    key_file = config.get("key_file") or "mom-data.key"
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
                "clientInfo": {"name": "mom-briefing-download", "version": "1.0"},
            },
        )
        for event in events:
            if "error" in event:
                raise RuntimeError(f"initialize 失败: {event['error']}")
        self.post("notifications/initialized", notify=True)

    def briefing(self, date):
        arguments = {"date": date} if date else {}
        events = self.post("tools/call", {"name": "mom_briefing", "arguments": arguments})
        for event in events:
            if "error" in event:
                raise RuntimeError(f"mom_briefing 失败: {event['error']}")
            result = event.get("result") or {}
            texts = [
                item.get("text", "")
                for item in result.get("content", [])
                if item.get("type") == "text"
            ]
            if not texts:
                continue
            payload = json.loads(texts[0])
            if payload.get("error_code"):
                raise RuntimeError(payload.get("msg") or "简报失败")
            return payload.get("data") or payload
        raise RuntimeError("没有返回简报")


def main():
    config = load_config()
    client = Mcp(config["mcp_url"], read_key(config))
    client.initialize()
    data = client.briefing((config.get("date") or "").strip())
    file_name = data.get("file_name") or "MOM风控简报.html"
    encoded = data.get("content_base64")
    if not encoded:
        raise RuntimeError("缺少 content_base64")
    out_dir = config["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, file_name)
    if os.path.exists(out_path):
        print(f"[skip] path={out_path} bytes={os.path.getsize(out_path)} action=skip")
        return
    with open(out_path, "wb") as handle:
        handle.write(base64.b64decode(encoded))
    print(f"[ok] path={out_path} bytes={os.path.getsize(out_path)} action=new date={data.get('date')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[fail] {exc}", file=sys.stderr)
        sys.exit(1)
