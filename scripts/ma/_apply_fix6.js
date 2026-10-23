const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")
const old = `      let nextAdj = prevCum > 0 ? prevAdj * nextCum / prevCum : nextCum
      if (nextAdj < nextCum) nextAdj = nextCum
      if (!isReasonableNav(nextCum) || !isReasonableNav(nextAdj)) continue
      sorted[i].cum_nav_withdrawal = String(+nextCum.toFixed(6))
      sorted[i].cumulative_nav = String(+nextAdj.toFixed(6))`
const neu = `      const ratioAdj = prevCum > 0 ? prevAdj * nextCum / prevCum : nextCum
      const nextAdj = Math.max(ratioAdj, nextCum)
      if (!isReasonableNav(nextCum) || !isReasonableNav(nextAdj)) continue
      sorted[i].cum_nav_withdrawal = String(+nextCum.toFixed(6))
      sorted[i].cumulative_nav = String(+nextAdj.toFixed(6))`
if (!t.includes(old.replace(/\n/g, "\r\n"))) throw new Error("old missing")
t = t.replace(old.replace(/\n/g, "\r\n"), neu.replace(/\n/g, "\r\n"))
fs.writeFileSync(path, t)
console.log("math.max applied")
