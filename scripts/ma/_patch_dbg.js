const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")
if (t.includes("DEBUG_NAV_STEP")) {
  console.log("already patched")
  process.exit(0)
}
fs.writeFileSync(path + ".bak", t)
t = t.replace(
  "function repairAdjBelowCumRows(rows: LegacyNavRow[]): LegacyNavRow[] {",
  "function repairAdjBelowCumRows(rows: LegacyNavRow[]): LegacyNavRow[] {\n  const __dbg = process.env.DEBUG_NAV_STEP === \"1\";"
)
t = t.replace(
  "sorted[i].cumulative_nav = String(filled)\n        lastGoodRatio = filled / cum",
  "sorted[i].cumulative_nav = String(filled)\n        if (__dbg) console.error(\"ADJ_BELOW_FWD\", sorted[i].price_date, adj, \"->\", filled, \"ratio\", lastGoodRatio)\n        lastGoodRatio = filled / cum"
)
t = t.replace(
  "sorted[i].cumulative_nav = String(rechained)\n    }\n  }\n\n  const flatAdjEps = 0.001",
  "sorted[i].cumulative_nav = String(rechained)\n      if (__dbg) console.error(\"ADJ_BELOW_FWD1\", sorted[i].price_date, adj, \"->\", rechained)\n    }\n  }\n\n  const flatAdjEps = 0.001"
)
const backNeedle = "if (isReasonableNav(filled) && filled >= cum + flatAdjEps) {\n      sorted[i].cumulative_nav = String(filled)\n    }\n  }\n\n  return sorted\n}"
const backRepl = "if (isReasonableNav(filled) && filled >= cum + flatAdjEps) {\n      sorted[i].cumulative_nav = String(filled)\n      if (__dbg) console.error(\"ADJ_BELOW_BACK\", sorted[i].price_date, adj, \"->\", filled, \"ratio\", trailingRatio)\n    }\n  }\n\n  return sorted\n}"
if (!t.includes(backNeedle)) {
  console.error("back needle missing")
  process.exit(1)
}
t = t.replace(backNeedle, backRepl)
const staleNeedle = "if (rechained) {\n      curr.cum_nav_withdrawal = rechained.cum\n      curr.cumulative_nav = rechained.adj\n    }\n  }\n\n  return sorted\n}\n\n/**\n * Legacy/platform rows sometimes store"
const staleRepl = "if (rechained) {\n      if (process.env.DEBUG_NAV_STEP === \"1\") console.error(\"STALE_REFRESH\", curr.price_date, {staleAdj, staleCum, spikeAdj, spikeCum, unit, prevUnit, adj, cum}, \"->\", rechained)\n      curr.cum_nav_withdrawal = rechained.cum\n      curr.cumulative_nav = rechained.adj\n    }\n  }\n\n  return sorted\n}\n\n/**\n * Legacy/platform rows sometimes store"
if (!t.includes(staleNeedle)) {
  console.error("stale needle missing")
  process.exit(1)
}
t = t.replace(staleNeedle, staleRepl)
fs.writeFileSync(path, t)
console.log("patched ok")
