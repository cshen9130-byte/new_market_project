import fs from "fs"

const path = "lib/server/email-nav-query.ts"
let s = fs.readFileSync(path, "utf8")
const nl = s.includes("\r\n") ? "\r\n" : "\n"

const startMarker = "export function mergeLegacyWithTeamNav("
const start = s.indexOf(startMarker)
if (start < 0) {
  console.error("start not found")
  process.exit(1)
}

let i = s.indexOf("{", start)
let depth = 0
let endPos = -1
for (; i < s.length; i++) {
  const ch = s[i]
  if (ch === "{") depth++
  else if (ch === "}") {
    depth--
    if (depth === 0) {
      endPos = i + 1
      break
    }
  }
}
if (endPos < 0) {
  console.error("brace end not found")
  process.exit(1)
}

const neu = [
  "export function mergeLegacyWithTeamNav(",
  "  legacyRows: LegacyNavRow[],",
  "  teamRows: LegacyNavRow[],",
  "  fundContext?: FundNavSeriesContext | null,",
  "): LegacyNavRow[] {",
  "  if (teamRows.length === 0) return finalizeNavSeries(legacyRows, new Set(), new Set(), fundContext)",
  "  const sortedTeam = [...teamRows].sort((a, b) => a.price_date.localeCompare(b.price_date))",
  "  const teamStart = sortedTeam[0]?.price_date ?? \"\"",
  "  const legacyFill = teamStart",
  "    ? legacyRows.filter((row) => row.price_date < teamStart)",
  "    : []",
  "  // Manual Excel uploads often omit 复权. Isolated team finalize then leaves adj≈cum or a",
  "  // tiny within-window premium. Pasting that after a legacy tip with a real adj/cum ratio",
  "  // (~1.31) cliffs 复权 (GA681A: 3.30→2.52 at 2026-05-29→06-05, then again when later",
  "  // team rows keep a wrong ~1.01 ratio). Clear collapsed / under-premium adj so finalize",
  "  // rechains from the legacy tip. Keep rows that already match the tip premium.",
  "  const legacyTip = legacyFill.length > 0 ? legacyFill[legacyFill.length - 1] : null",
  "  const tipCum = legacyTip ? parseOptionalNav(legacyTip.cum_nav_withdrawal) : null",
  "  const tipAdj = legacyTip ? parseOptionalNav(legacyTip.cumulative_nav) : null",
  "  const tipRatio =",
  "    tipCum != null && tipCum > 0 && tipAdj != null && tipAdj > tipCum + 0.05",
  "      ? tipAdj / tipCum",
  "      : null",
  "  const preparedTeam = sortedTeam.map((row) => {",
  "    const unit = parseOptionalNav(row.nav)",
  "    const cum = parseOptionalNav(row.cum_nav_withdrawal)",
  "    const adj = parseOptionalNav(row.cumulative_nav)",
  "    if (adj == null) return { ...row, cumulative_nav: \"\" }",
  "    if (",
  "      unit != null",
  "      && cum != null",
  "      && hasDividendOffset(unit, cum)",
  "      && adj <= cum + 0.005",
  "    ) {",
  "      return { ...row, cumulative_nav: \"\" }",
  "    }",
  "    if (tipRatio != null && cum != null && cum > 0 && adj / cum < tipRatio - 0.05) {",
  "      return { ...row, cumulative_nav: \"\" }",
  "    }",
  "    return { ...row }",
  "  })",
  "  const merged = [",
  "    ...legacyFill,",
  "    ...preparedTeam,",
  "  ].sort((a, b) => a.price_date.localeCompare(b.price_date))",
  "  return finalizeNavSeries(merged, new Set(), new Set(), fundContext)",
  "}",
].join(nl)

s = s.slice(0, start) + neu + s.slice(endPos)
fs.writeFileSync(path, s)
console.log("patched mergeLegacyWithTeamNav v2")
