const fs = require("fs")
const path = "D:/coding/market_website/lib/server/share-class-nav-fill.ts"
let t = fs.readFileSync(path, "utf8")
if (t.includes("LC571B after parent history")) {
  console.log("already extended")
  process.exit(0)
}
// Replace the early-continue for original days with a collapse-carry path
const old = `    if (index === 0 || originalDays.has(rowDay(row))) {
      out.push(row)
      continue
    }
    const unit = positiveNav(row.nav)
    const cum = positiveNav(row.cum_nav_withdrawal) ?? positiveNav(row.cumulative_nav)
    const adj = positiveNav(row.cumulative_nav)
    if (unit == null) {
      out.push(row)
      continue
    }
    if (cum != null && Math.abs(cum - unit) / unit > COLLAPSED_TOL) {
      out.push(row)
      continue
    }
    if (adj != null && Math.abs(adj - unit) / unit > COLLAPSED_TOL) {
      out.push(row)
      continue
    }`

const neu = `    if (index === 0) {
      out.push(row)
      continue
    }
    const unit = positiveNav(row.nav)
    const cum = positiveNav(row.cum_nav_withdrawal) ?? positiveNav(row.cumulative_nav)
    const adj = positiveNav(row.cumulative_nav)
    if (unit == null) {
      out.push(row)
      continue
    }
    // Filled unit-only dates always try to inherit the prior gap. Own dates that
    // publish 单位=累计=复权 after a gap-bearing filled prefix (LC571B after parent
    // history) need the same carry — finalize already ran before the fill.
    const isOriginal = originalDays.has(rowDay(row))
    const collapsedCum = cum == null || Math.abs(cum - unit) / unit <= COLLAPSED_TOL
    const collapsedAdj = adj == null || Math.abs(adj - unit) / unit <= COLLAPSED_TOL
    if (!collapsedCum || !collapsedAdj) {
      out.push(row)
      continue
    }
    if (isOriginal) {
      // only continue a gap that came from the donor prefix; leave a true
      // unit-only series (no prior dividend gap) untouched
    } else {
      // filled row: always eligible when collapsed
    }`

if (!t.includes(old.replace(/\n/g, "\r\n")) && !t.includes(old)) {
  // try with crlf
  const crlf = old.replace(/\n/g, "\r\n")
  if (!t.includes(crlf)) {
    console.log("OLD BLOCK:\n", JSON.stringify(t.slice(t.indexOf("if (index === 0"), t.indexOf("if (index === 0")+800)))
    throw new Error("old block not found")
  }
  t = t.replace(crlf, neu.replace(/\n/g, "\r\n"))
} else {
  t = t.replace(old.replace(/\n/g, "\r\n"), neu.replace(/\n/g, "\r\n"))
  if (!t.includes("LC571B after parent history")) {
    t = t.replace(old, neu.replace(/\n/g, "\r\n"))
  }
}
if (!t.includes("LC571B after parent history")) throw new Error("replace failed")
fs.writeFileSync(path, t)
console.log("carry extended for original collapsed tail")
