const fs = require("fs")
const path = "D:/coding/market_website/lib/server/share-class-nav-fill.ts"
let t = fs.readFileSync(path, "utf8")
t = t.replace(
  "  const originalDays = new Set(original.map((row) => rowDay(row)))\r\n  const sorted = [...filled].sort((a, b) => rowDay(a).localeCompare(rowDay(b)))\r\n",
  "  const sorted = [...filled].sort((a, b) => rowDay(a).localeCompare(rowDay(b)))\r\n"
)
// keep parameter name used - prefix with underscore via void to avoid unused lint on original
if (!t.includes("void original")) {
  t = t.replace(
    ">(original: T[], filled: T[]): T[] {\r\n  const sorted",
    ">(original: T[], filled: T[]): T[] {\r\n  void original\r\n  const sorted"
  )
}
fs.writeFileSync(path, t)
console.log("cleaned unused originalDays")
