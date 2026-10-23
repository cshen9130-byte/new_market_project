const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")

// 1) Loosen adjContinuesAtUnitReturn tolerance
const oldUnit = `  return Math.abs(adj - prevAdj * unit / prevUnit) <= STORED_ORIENTATION_ABS
}`
const neuUnit = `  const expected = prevAdj * unit / prevUnit
  return Math.abs(adj - expected) <= STORED_ORIENTATION_ABS
    || Math.abs(adj - expected) / Math.max(adj, expected) <= 0.002
}`
if (!t.includes(oldUnit.replace(/\n/g, "\r\n"))) throw new Error("unit return tol missing")
t = t.replace(oldUnit.replace(/\n/g, "\r\n"), neuUnit.replace(/\n/g, "\r\n"))

// 2) Small unit wiggle with flat derived fields is not stale (SJE164 2020-07-21)
const staleAnchor = "    // Unit recovering toward"
if (!t.includes("small unit wiggle")) {
  const insert = `    // A sub-2% 单位 wiggle with flat 累计/复权 is noise on series that do not
    // track 单位 day-to-day (SJE164 2020-07-21). Collapsing them to 单位 for one
    // day creates a spike the next print reverses.
    if (
      (staleAdj || staleCum)
      && !spikeAdj
      && !spikeCum
      && unitRet < 0.02
    ) {
      continue
    }

`
  if (!t.includes(staleAnchor)) throw new Error("stale anchor missing")
  t = t.replace(
    "    // Unit recovering toward",
    insert.replace(/\n/g, "\r\n") + "    // Unit recovering toward",
  )
}

fs.writeFileSync(path, t)
console.log("tolerance + small-wiggle skip applied")
