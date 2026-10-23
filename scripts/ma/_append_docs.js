const fs = require("fs")
const path = "D:/coding/market_website/docs/nav-calculation-rules.md"
let t = fs.readFileSync(path, "utf8")
if (t.includes("What Was Fixed (计算或修正导致 cohort")) {
  console.log("docs already appended")
  process.exit(0)
}
const section = `

---

## What Was Fixed (计算或修正导致 cohort — share-class carry + adj guards, 2026-10-23)

### The Problem

平台数据 with 异常成因 = **计算或修正导致** listed about **28** products. Notes often said 前一点在[Source]，现突点由计算或修正生成. Many were not bad vendor prints: the merge/finalize path invented a one-day 复权 spike or dropped a dividend gap onto 单位=累计=复权.

### Root-cause groups

1. **Share-class multi-day / tail collapse** — \`carryDividendGapOntoFilledRows\` only fixed the first filled day after an original row (it read \`sorted[i-1]\`, not the already-carried output). Later filled days kept 复权=单位. The B类 unit-only tail after a parent history had the same cliff (finalize already ran before the fill).
   - Covers: **SLC571** (2025-06-23..26), **LC571B** (after parent history)

2. **Unit-only tail after a rebase / gap-bearing predecessor** — \`repairAdjCollapsedToUnitRows\` only fixed 复权≈单位 while 累计 still had a gap. Full 单位=累计=复权 after a gap-bearing row stayed collapsed. \`rechainDerivedFromPrev\` could also emit adj slightly below cum.
   - Covers: **SVL369** (2023-07-17 after unit rebase)

3. **Post-ex-div unit recovery treated as stale** — after an ex-div, 单位 recovers to 累计 while 累计/复权 stay flat. \`refreshStaleDerivedFields\` rechained and reopened the dividend gap for one day.
   - Covers: **SEM163** (2019-01-14)

4. **Premium paint over intentional adj < cum** — some feeds keep 复权 on the 单位 return while 累计 sits above on a dividend gap. \`repairAdjBelowCumRows\` / column-swap treated that as broken and painted a later adj/cum premium (or swapped columns).
   - Covers: **S39917**, **SD9197**

5. **Small unit wiggle / restatement false stale** — sub-2% 单位 noise with flat derived fields, or a joint 复权+累计 restatement, was rechained into a one-day spike.
   - Covers: **SJE164** (2020-07-21), **SGK119** (now labels as 源数据异常)

6. **Unit halving that already closed the gap** — \`sourceAlreadyClosedDividendGap\` only short-circuited rebound (≥1.5×), not rebase/halving (≤0.5×).
   - Helps: **SCB622** (2020-04-10 path); a residual jump on 2020-04-14 may remain

### The Correct Fix Applied

| Area | File / function | What changed |
|---|---|---|
| Multi-day carry | \`carryDividendGapOntoFilledRows\` in \`share-class-nav-fill.ts\` | Walk \`out[i-1]\`; also carry onto later collapsed own rows after a gap-bearing prefix |
| Full collapse | \`repairAdjCollapsedToUnitRows\` in \`email-nav-query.ts\` | Carry 累计 gap + 复权 when 单位≈累计≈复权 after a gap-bearing prev; skip when unit recovered to prior 累计 (SEM163) |
| Rechain floor | \`rechainDerivedFromPrev\` | Floor emitted 复权 at 累计 |
| Stale refresh | \`refreshStaleDerivedFields\` | Skip unit-recovery, sub-2% wiggles, and adj+cum restatements |
| Unit-return guard | \`adjContinuesAtUnitReturn\` + \`repairAdjBelowCumRows\` / \`repairSwappedCumAdjRows\` | Do not premium-fill or column-swap when 复权 already follows 单位 (abs or 0.2% rel) |
| Moved-adj skip | premium loops in \`repairAdjBelowCumRows\` | If stored 复权 already stepped vs prev, do not paint |
| Halving close | large-jump branch in \`rechainDerivedFromPrev\` | \`sourceAlreadyClosedDividendGap\` for both ≤0.5 and ≥1.5 |

### What This Fix Does NOT Change

- Every **What Was Fixed** case above this section (SBAH99, SBPC20, S29263, SAAL90, TV890A, SQX646, …)
- Invariant \`adj >= cum >= unit\` on rechained rows
- Existing dividend / rechain paths for real ex-div days
- Vendor jumps that already sit in one feed (now correctly labeled 源数据异常): **SN3648**, **SGH173**, **SSH449**, **SVC066**, **SNN006**, **SQD690**, **SLC571** 2026-01-30, **SGK119** 2021-03-19, **SXV381** 2025-04-07

### Remaining 计算或修正导致 (not fixed here)

| Code | Why left |
|---|---|
| **SVP162** | Email 单位 itself has a ~5.8% V on 2026-02-06; \`sanitizeVShapeNavOutliers\` threshold is 7%. Lowering it risks R0423B-style false flats |
| **SLN974** | type6 vs 火富牛 复权 scale handoff mid-series; needs a dedicated source-preference rule |
| **SCB622** | Residual 2020-04-14 step after the rebase week |
| **SEM163** | Separate 2019-06-28 neighborhood still inflated vs type6 |
| **SCY439** | 2024-06-26 unit/adj rewrite vs type6 |

Stale list flags for funds that are now clean still need a 净值断档 reload (or flag rule bump) and detail-cache rebuild on each machine.

### Verified

\`\`\`bash
npx tsx --test lib/server/share-class-nav-fill.test.ts
npx tsx scripts/test-nav-anomaly.mjs
npx tsx scripts/ma/_test_new_rules.mjs
\`\`\`

\`scripts/test-nav-rechain.mjs\` still stops early on a pre-existing SSG947 \`selectEmailNavSeriesRows\` assertion (06-23 row filtered); that failure is unrelated to this cohort.
`
t = t.trimEnd() + section.replace(/\n/g, "\r\n") + "\r\n"
fs.writeFileSync(path, t)
console.log("docs appended, len", t.length)
