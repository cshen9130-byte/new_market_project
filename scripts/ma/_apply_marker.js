const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")
if (!t.includes("MARKER_SVL_TEST")) {
  t = t.replace(
    "sorted[i].cumulative_nav = String(+nextAdj.toFixed(6))\r\n    }\r\n  }\r\n\r\n  return sorted\r\n}\r\n\r\n/** When 复权 drifted below 累计",
    "sorted[i].cumulative_nav = String(+nextAdj.toFixed(6))\r\n      if (sorted[i].price_date === \"2023-07-17\") sorted[i].cumulative_nav = \"9.999999\" // MARKER_SVL_TEST\r\n    }\r\n  }\r\n\r\n  return sorted\r\n}\r\n\r\n/** When 复权 drifted below 累计"
  )
  if (!t.includes("MARKER_SVL_TEST")) throw new Error("marker not inserted")
  fs.writeFileSync(path, t)
  console.log("marker inserted")
}
