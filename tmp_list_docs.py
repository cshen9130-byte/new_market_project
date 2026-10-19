from pathlib import Path
docs = Path(r"d:\coding\market_website\docs")
for p in docs.iterdir():
    if p.suffix.lower() == ".docx" or p.is_dir():
        print(p.name.encode("unicode_escape").decode(), p.stat().st_size if p.is_file() else "DIR")
charts = docs / "strategy-observation-compare-charts"
if charts.exists():
    for c in charts.iterdir():
        print("CHART", c.name, c.stat().st_size)
