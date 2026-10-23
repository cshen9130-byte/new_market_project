const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")

// 1) sourceAlreadyClosedDividendGap for BOTH large-jump directions
const old = `  if ((unitRatio <= 0.5 || unitRatio >= 1.5) && prevPostDiv) {
    const cumUnitGap = prevCumW - prevUnit
    if (unitRatio >= 1.5 && sourceAlreadyClosedDividendGap(unit, currCum, cumUnitGap, currAdj)) return null`
const neu = `  if ((unitRatio <= 0.5 || unitRatio >= 1.5) && prevPostDiv) {
    const cumUnitGap = prevCumW - prevUnit
    // Unit rebound (>=1.5) or rebase/halving (<=0.5) that already sits on 单位
    // for 累计 must not reopen the old gap (SEM163 rebound; SCB622 2020-04-10).
    if (sourceAlreadyClosedDividendGap(unit, currCum, cumUnitGap, currAdj)) return null`
if (!t.includes(old.replace(/\n/g, "\r\n"))) throw new Error("large-jump needle missing")
t = t.replace(old.replace(/\n/g, "\r\n"), neu.replace(/\n/g, "\r\n"))

// 2) Skip premium fill when stored adj already moved vs prev
const prem = `    if (i > 0 && (
      storedCumAndAdjContinue(original[i - 1], original[i])
      || adjContinuesAtCumReturn(original[i - 1], original[i])
      || adjContinuesAtUnitReturn(original[i - 1], original[i])
    )) continue`
const prem2 = `    if (i > 0 && (
      storedCumAndAdjContinue(original[i - 1], original[i])
      || adjContinuesAtCumReturn(original[i - 1], original[i])
      || adjContinuesAtUnitReturn(original[i - 1], original[i])
    )) continue
    // Stored 复权 already took a real step. Being below 累计 is a scale choice
    // (SGK119 / SXV381 / SEM163), not a frozen field to paint over.
    if (i > 0) {
      const prevAdj0 = parseOptionalNav(original[i - 1].cumulative_nav)
      if (
        prevAdj0 != null
        && adj != null
        && Math.abs(adj / prevAdj0 - 1) > 0.001
      ) continue
    }`
// Only replace in forward loop - first occurrence after flatAdjEps. Do both premium loops.
let count = 0
t = t.replaceAll(prem.replace(/\n/g, "\r\n"), () => {
  count += 1
  return prem2.replace(/\n/g, "\r\n")
})
console.log("premium replacements", count)
if (count < 2) throw new Error("expected 2 premium loop replacements")

fs.writeFileSync(path, t)
console.log("scb622 + moved-adj skip applied")
