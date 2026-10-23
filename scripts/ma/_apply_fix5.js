const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")
const needle = `      const nextCum = unit + (prevCum - prevUnit)
      const nextAdj = prevAdj * unitRatio
      if (!isReasonableNav(nextCum) || !isReasonableNav(nextAdj) || nextAdj + flatEps < nextCum) continue
      sorted[i].cum_nav_withdrawal = String(+nextCum.toFixed(6))
      sorted[i].cumulative_nav = String(+nextAdj.toFixed(6))`
const insert = `      const nextCum = unit + (prevCum - prevUnit)
      // Prefer cum-ratio so a prior adj slightly below cum (SVL369) does not
      // write adj < cum. Floor at nextCum to keep adj >= cum.
      let nextAdj = prevCum > 0 ? prevAdj * nextCum / prevCum : nextCum
      if (nextAdj < nextCum) nextAdj = nextCum
      if (!isReasonableNav(nextCum) || !isReasonableNav(nextAdj)) continue
      sorted[i].cum_nav_withdrawal = String(+nextCum.toFixed(6))
      sorted[i].cumulative_nav = String(+nextAdj.toFixed(6))`
const crlfNeedle = needle.replace(/\n/g, "\r\n")
const crlfInsert = insert.replace(/\n/g, "\r\n")
if (!t.includes(crlfNeedle)) throw new Error("needle missing")
t = t.replace(crlfNeedle, crlfInsert)
fs.writeFileSync(path, t)
console.log("adj floor fixed")
