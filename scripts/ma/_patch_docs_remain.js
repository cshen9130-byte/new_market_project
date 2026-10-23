const fs = require("fs")
const path = "D:/coding/market_website/docs/nav-calculation-rules.md"
let t = fs.readFileSync(path, "utf8")
const old = `| **SVP162** | Email 单位 itself has a ~5.8% V on 2026-02-06; \`sanitizeVShapeNavOutliers\` threshold is 7%. Lowering it risks R0423B-style false flats |
| **SLN974** | type6 vs 火富牛 复权 scale handoff mid-series; needs a dedicated source-preference rule |
| **SCB622** | Residual 2020-04-14 step after the rebase week |
| **SEM163** | Separate 2019-06-28 neighborhood still inflated vs type6 |
| **SCY439** | 2024-06-26 unit/adj rewrite vs type6 |`
const neu = `| **SVP162** | Email 单位 itself has a ~5.8% V on 2026-02-06; \`sanitizeVShapeNavOutliers\` threshold is 7%. Lowering it risks R0423B-style false flats |
| **SLN974** | type6 vs 火富牛 复权 scale handoff mid-series; needs a dedicated source-preference rule |
| **SCB622** | Residual 2020-04-14 step after the rebase week |
| **SEM163** | Separate 2019-06-28 neighborhood still inflated vs type6 |
| **SCY439** | 2024-06-26 unit/adj rewrite vs type6 |
| **SVL369** | 2023-07-17 rebase tail is fixed; a later 2023-08-15 collapse (累计 already flat while 复权 still elevated on 08-14) still cliffs |`
if (t.includes("2023-08-15 collapse")) {
  console.log("docs remaining already updated")
} else if (!t.includes(old.replace(/\n/g, "\r\n")) && !t.includes(old)) {
  // try find the table
  const i = t.indexOf("**SVP162**")
  console.log("snippet", JSON.stringify(t.slice(i, i+500)))
  throw new Error("remaining table not found")
} else {
  t = t.replace(old.replace(/\n/g, "\r\n"), neu.replace(/\n/g, "\r\n"))
  if (!t.includes("2023-08-15 collapse")) t = t.replace(old, neu.replace(/\n/g, "\r\n"))
  fs.writeFileSync(path, t)
  console.log("docs remaining updated")
}
