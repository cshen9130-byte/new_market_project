import json
notes=json.load(open("/root/market_dashboard_storage/investment-notes/notes.json",encoding="utf-8"))
AUTHOR="\u5916\u90e8\u7b14\u8bb0"
ext=[n for n in notes if n.get("creator")==AUTHOR]
empty=[n for n in ext if not (n.get("associations") or [])]
print("empty", len(empty))
for n in empty[:20]:
    ep=n.get("extractedProducts") or []
    matched=sum(1 for p in ep if p.get("confidence") in ("matched","applied") and str(p.get("recordNo") or "").strip())
    print(f"EMPTY matched={matched} extracted={len(ep)} | {n.get('title','')[:80]}")
# one linked sample detail
n=[x for x in notes if x.get("id")=="1790260231127-b2abf1"][0]
print("SAMPLE_ASSOC", json.dumps(n.get("associations"), ensure_ascii=False))
