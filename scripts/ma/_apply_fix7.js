const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")

// Remove marker
t = t.replace(/\r\n      if \(sorted\[i\]\.price_date === \"2023-07-17\"\) sorted\[i\]\.cumulative_nav = \"9\.999999\" \/\/ MARKER_SVL_TEST/, "")

// Floor adj in final rechain return
const old = `  // Grow adj at the cumulative rate to maintain adj/cum ratio constant (≥ 1 after ex-div).
  const adj = prevCum > 0 ? prevAdj * cum / prevCum : prevAdj * unitRatio
  if (!isReasonableNav(adj) || !isReasonableNav(cum)) return null

  return { cum: String(+cum.toFixed(6)), adj: String(+adj.toFixed(6)) }
}`
const neu = `  // Grow adj at the cumulative rate to maintain adj/cum ratio constant (≥ 1 after ex-div).
  let adj = prevCum > 0 ? prevAdj * cum / prevCum : prevAdj * unitRatio
  // Prior row may already have adj slightly below cum (SVL369). Do not emit adj < cum.
  if (adj < cum) adj = cum
  if (!isReasonableNav(adj) || !isReasonableNav(cum)) return null

  return { cum: String(+cum.toFixed(6)), adj: String(+adj.toFixed(6)) }
}`
if (!t.includes(old.replace(/\n/g, "\r\n"))) {
  const i = t.indexOf("Grow adj at the cumulative rate")
  console.log(JSON.stringify(t.slice(i, i+350)))
  throw new Error("rechain floor needle missing")
}
t = t.replace(old.replace(/\n/g, "\r\n"), neu.replace(/\n/g, "\r\n"))
if (t.includes("MARKER_SVL_TEST")) throw new Error("marker still present")
fs.writeFileSync(path, t)
console.log("rechain floor + marker removed")
