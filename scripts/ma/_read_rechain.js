const fs = require("fs")
const t = fs.readFileSync("D:/coding/market_website/lib/server/email-nav-query.ts", "utf8")
const j = t.indexOf("own") 
// find near rechain
const k = t.indexOf("left the old dividend gap")
console.log("idx", k)
console.log(t.slice(k - 80, k + 1600))
