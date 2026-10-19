import fs from "fs"

// --- Append regression test ---
const testPath = "scripts/test-nav-rechain.mjs"
let test = fs.readFileSync(testPath, "utf8")
const nl = test.includes("\r\n") ? "\r\n" : "\n"

if (test.includes("GA681A team adj rechains from legacy tip")) {
  console.log("test already present")
} else {
  const block = [
    "{",
    "  // GA681A: legacy tip has adj/cum ~1.31; team upload omits 复权 so isolated finalize",
    "  // leaves adj≈cum (or a tiny within-window premium). mergeLegacyWithTeamNav must",
    "  // clear under-premium adj and rechain from the legacy tip.",
    "  const legacy = [",
    "    { price_date: \"2026-05-22\", nav: \"1.8072\", cumulative_nav: \"3.330939\", cum_nav_withdrawal: \"2.5332\", price_change: \"\" },",
    "    { price_date: \"2026-05-29\", nav: \"1.7908\", cumulative_nav: \"3.300711\", cum_nav_withdrawal: \"2.5168\", price_change: \"\" },",
    "  ]",
    "  const teamIsolated = mergeNavSeriesWithEmail([], [",
    "    { price_date: \"2026-06-05\", nav: \"1.7917\", cumulative_nav: \"2.5177\", adjusted_nav: null },",
    "    { price_date: \"2026-06-12\", nav: \"1.7878\", cumulative_nav: \"2.5138\", adjusted_nav: null },",
    "    { price_date: \"2026-06-18\", nav: \"1.7944\", cumulative_nav: \"2.5204\", adjusted_nav: null },",
    "    { price_date: \"2026-06-26\", nav: \"1.8531\", cumulative_nav: \"2.5791\", adjusted_nav: null },",
    "    { price_date: \"2026-09-24\", nav: \"1.8601\", cumulative_nav: \"2.5861\", adjusted_nav: null },",
    "  ])",
    "  const jun05Iso = teamIsolated.find((r) => r.price_date === \"2026-06-05\")",
    "  assert(",
    "    \"GA681A isolated team collapses adj near cum\",",
    "    jun05Iso != null",
    "      && Math.abs(parseFloat(jun05Iso.cumulative_nav) - parseFloat(jun05Iso.cum_nav_withdrawal)) < 0.05,",
    "  )",
    "  const merged = mergeLegacyWithTeamNav(legacy, teamIsolated, {",
    "    beian_hao: \"GA681A\",",
    "    product_name: \"集微投资2期A类\",",
    "  })",
    "  const may29 = merged.find((r) => r.price_date === \"2026-05-29\")",
    "  const jun05 = merged.find((r) => r.price_date === \"2026-06-05\")",
    "  const jun26 = merged.find((r) => r.price_date === \"2026-06-26\")",
    "  const tip = merged.find((r) => r.price_date === \"2026-09-24\")",
    "  const tipRatio = parseFloat(may29.cumulative_nav) / parseFloat(may29.cum_nav_withdrawal)",
    "  assert(\"GA681A team adj rechains from legacy tip\", jun05 != null && tip != null && jun26 != null)",
    "  assert(",
    "    \"GA681A handoff keeps adj/cum ratio\",",
    "    Math.abs(parseFloat(jun05.cumulative_nav) / parseFloat(jun05.cum_nav_withdrawal) - tipRatio) < 0.01,",
    "  )",
    "  assert(",
    "    \"GA681A mid-team keeps adj/cum ratio\",",
    "    Math.abs(parseFloat(jun26.cumulative_nav) / parseFloat(jun26.cum_nav_withdrawal) - tipRatio) < 0.01,",
    "  )",
    "  assert(",
    "    \"GA681A tip adj stays on legacy premium (~3.39 not ~2.62)\",",
    "    parseFloat(tip.cumulative_nav) > 3.3",
    "      && Math.abs(parseFloat(tip.cumulative_nav) / parseFloat(tip.cum_nav_withdrawal) - tipRatio) < 0.01,",
    "  )",
    "  assert(",
    "    \"GA681A invariant on merged tail\",",
    "    [jun05, jun26, tip].every((r) => {",
    "      const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal), a = parseFloat(r.cumulative_nav)",
    "      return a + 1e-6 >= c && c + 1e-6 >= u",
    "    }),",
    "  )",
    "}",
    "",
  ].join(nl)
  test = test.trimEnd() + nl + nl + block + nl
  fs.writeFileSync(testPath, test)
  console.log("appended GA681A test")
}

// --- Append docs section ---
const docPath = "docs/nav-calculation-rules.md"
let doc = fs.readFileSync(docPath, "utf8")
const dnl = doc.includes("\r\n") ? "\r\n" : "\n"
if (doc.includes("集微投资2期A类") && doc.includes("GA681A")) {
  console.log("docs already mention GA681A")
} else {
  const section = [
    "",
    "## What Was Fixed (集微投资2期A类 — GA681A, 2026-09-30)",
    "",
    "**Symptom:** Product detail for **集微投资2期A类 / GA681A** showed unit **1.8601**, 累计 **2.5861**, 复权 **~2.6155** on **2026-09-24**. The 复权 chart looked wrong because historical platform/group 复权 was already **~3.30** on **2026-05-29** (adj/cum ≈ **1.311**), then collapsed after the manual team upload started.",
    "",
    "### Root Cause",
    "",
    "1. `ops_team_nav_manual` for GA681A (uploaded 2026-09-29) stored unit + 累计 only (`adjusted_nav` null), starting **2026-06-05**.",
    "2. `loadManagedProductNavSeries` finalizes that team stream **in isolation** → 复权 ≈ 累计 (or a tiny within-window premium).",
    "3. `mergeLegacyWithTeamNav` pasted those team rows after the legacy tip (`private_fund_nav_group` through **2026-05-29**, adj **3.300711**) without clearing the collapsed 复权, so finalize kept adj≈cum and the chart cliffed **3.30 → ~2.52**.",
    "4. Unit and 累计 were already correct (constant dividend gap **0.726**); only 复权 was wrong.",
    "",
    "### Fix",
    "",
    "| Area | File / function | What changed |",
    "|---|---|---|",
    "| Clear under-premium team adj | `mergeLegacyWithTeamNav` | If legacy tip has adj/cum premium (>0.05), clear team 复权 that is collapsed to 累计 **or** whose adj/cum is more than 0.05 below the tip ratio, then let finalize rechain |",
    "| Data | `ops_team_nav_manual` GA681A | Set `adjusted_nav` from the corrected merge (19 rows) |",
    "| Cache | `ops_private_fund_detail_nav_cache` GA681A | Invalidated + refreshed |",
    "",
    "### Verified Correct Values (after fix)",
    "",
    "| Date | 单位净值 | 累计净值 | 复权净值 |",
    "|---|---|---|---|",
    "| 2026-05-29 (legacy tip) | 1.7908 | 2.5168 | **3.300711** |",
    "| 2026-06-05 (first team) | 1.7917 | 2.5177 | **3.301891** |",
    "| 2026-06-26 | 1.8531 | 2.5791 | **3.382415** |",
    "| 2026-09-24 (tip) | 1.8601 | 2.5861 | **3.391599** |",
    "",
    "Invariant `adj >= cum >= unit` holds; adj/cum stays ≈ **1.311** across the team handoff.",
    "",
    "### What This Fix Does NOT Change",
    "",
    "- SBAH99 dividend formulas (`syncExDivAdjustedNav`, `rechainDerivedFromPrev`, etc.)",
    "- SNF018 virtual-first FOF email priority",
    "- SSG947 seed merge, SQX078 swap repair, BUK40A append-email-after-team-tip",
    "- Team window exclusivity (SZJ909)",
    "",
    "### Regression",
    "",
    "```bash",
    "npx tsx scripts/test-nav-rechain.mjs",
    "```",
    "",
    "Includes assertion block **GA681A team adj rechains from legacy tip**.",
    "",
  ].join(dnl)
  doc = doc.trimEnd() + dnl + section
  fs.writeFileSync(docPath, doc)
  console.log("appended docs section")
}
