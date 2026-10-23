const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")
const needle = `      if (
        prevUnit == null || prevUnit <= 0 || prevCum == null || prevAdj == null
        || !hasDividendOffset(prevUnit, prevCum)
        || !isReasonableNav(prevAdj)
      ) continue
      const unitRatio = unit / prevUnit
      if (unitRatio <= 0.7 || unitRatio >= 1 / 0.7) continue`
const insert = `      if (
        prevUnit == null || prevUnit <= 0 || prevCum == null || prevAdj == null
        || !hasDividendOffset(prevUnit, prevCum)
        || !isReasonableNav(prevAdj)
      ) continue
      // Unit recovered to the prior 累计 after an ex-div (SEM163 2019-01-14).
      // Reopening that gap would spike 复权 for one day.
      if (Math.abs(unit - prevCum) <= Math.max(0.01, prevCum * 0.005)) continue
      const unitRatio = unit / prevUnit
      if (unitRatio <= 0.7 || unitRatio >= 1 / 0.7) continue`
const crlfNeedle = needle.replace(/\n/g, "\r\n")
const crlfInsert = insert.replace(/\n/g, "\r\n")
if (!t.includes(crlfNeedle)) {
  console.log("needle missing, snippet:")
  const i = t.indexOf("Full collapse")
  console.log(JSON.stringify(t.slice(i, i+900)))
  process.exit(1)
}
t = t.replace(crlfNeedle, crlfInsert)
fs.writeFileSync(path, t)
console.log("SEM163 guard added to full-collapse repair")
