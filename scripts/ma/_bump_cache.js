const fs = require("fs")
const glob = [
  "D:/coding/market_website/lib/server/nav-series-flags-pg.ts",
  "D:/coding/market_website/app/ma/api/private-funds/platform-data/route.ts",
  "D:/coding/market_website/app/ma/api/team-data/route.ts",
  "D:/coding/market_website/app/ma/api/team-data/list/route.ts",
]
for (const p of glob) {
  if (!fs.existsSync(p)) { console.log("skip missing", p); continue }
  let t = fs.readFileSync(p, "utf8")
  const before = t
  t = t.replace(/nav_gap_rebase_v7/g, "nav_gap_rebase_v8")
  t = t.replace(/platform_data_list_cache_v7/g, "platform_data_list_cache_v8")
  t = t.replace(/jump30_spike15_quiet5x8_gap10_v4/g, "jump30_spike15_quiet5x8_gap10_v5")
  if (t !== before) {
    fs.writeFileSync(p, t)
    console.log("bumped", p)
  } else {
    // show what keys exist
    const keys = [...t.matchAll(/nav_gap[a-z0-9_]*|platform_data_list_cache_v\d+|jump30_spike[a-z0-9_]+/g)].map(m => m[0])
    console.log("no bump", p, "keys", [...new Set(keys)].slice(0, 10).join(","))
  }
}
