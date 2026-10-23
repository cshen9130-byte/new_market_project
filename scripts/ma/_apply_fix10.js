const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")
if (t.includes("both derived fields restated")) {
  console.log("already present")
  process.exit(0)
}
const anchor = "    // A sub-2% 单位 wiggle"
const insert = `    // 复权 crashed while 累计 also stepped to a new reasonable level
    // (SGK119 2021-03-19). That is a restatement, not a one-field spike to rechain.
    if (
      spikeAdj
      && !spikeCum
      && adj != null
      && cum != null
      && prevCum != null
      && isReasonableNav(adj)
      && isReasonableNav(cum)
      && Math.abs(cum / prevCum - 1) > 0.05
    ) {
      continue
    }

`
if (!t.includes(anchor)) throw new Error("anchor missing")
t = t.replace(anchor, insert.replace(/\n/g, "\r\n") + anchor)
fs.writeFileSync(path, t)
console.log("restatement skip added")
