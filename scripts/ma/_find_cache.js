const fs = require("fs")
const path = require("path")
function walk(dir, out=[]) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".next" || ent.name === ".git") continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) out.push(p)
  }
  return out
}
const files = walk("D:/coding/market_website")
for (const f of files) {
  const t = fs.readFileSync(f, "utf8")
  if (/nav_gap_rebase_v\d+|platform_data_list_cache_v\d+|team_data_list_cache_v\d+/.test(t)) {
    const keys = [...t.matchAll(/nav_gap_rebase_v\d+|platform_data_list_cache_v\d+|team_data_list_cache_v\d+/g)].map(m => m[0])
    console.log([...new Set(keys)].join(","), "=>", f.replace(/\\/g, "/").replace("D:/coding/market_website/", ""))
  }
}
