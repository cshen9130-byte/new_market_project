import json
from pathlib import Path
p = Path(r"C:\Users\Administrator\.cursor\projects\d-coding-market-website\agent-transcripts\6bb06edd-4e37-435d-a03a-f85e651ef15c\6bb06edd-4e37-435d-a03a-f85e651ef15c.jsonl")
# find the write of tmp_build_fof99_report.py
out = Path(r"d:\coding\market_website\tmp_orig_report_script.py")
found = False
with p.open(encoding="utf-8") as f:
    for line in f:
        if "tmp_build_fof99_report.py" in line and "matplotlib" in line and not found:
            obj = json.loads(line)
            # walk content
            msg = obj.get("message", {})
            content = msg.get("content", [])
            for block in content:
                if block.get("type") == "tool_use" and block.get("name") == "Write":
                    inp = block.get("input", {})
                    if str(inp.get("path","")).endswith("tmp_build_fof99_report.py"):
                        out.write_text(inp["contents"], encoding="utf-8")
                        print("wrote", len(inp["contents"]))
                        found = True
print("found", found)
