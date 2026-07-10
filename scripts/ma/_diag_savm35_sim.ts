import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query"

// Broken platform tail: unit halved (~0.74) while cum stuck ~1.489
const brokenLegacy = [
  { price_date: "2026-06-12", nav: "0.6626", cum_nav_withdrawal: "1.3253", cumulative_nav: "1.3253", price_change: "" },
  { price_date: "2026-07-08", nav: "0.7279", cum_nav_withdrawal: "1.4769", cumulative_nav: "1.4769", price_change: "" },
  { price_date: "2026-07-09", nav: "0.7400", cum_nav_withdrawal: "1.4890", cumulative_nav: "1.4890", price_change: "" },
]

// Correct post-div legacy (from tunnel merge before email)
const goodLegacy = [
  { price_date: "2026-06-12", nav: "1.184", cum_nav_withdrawal: "1.933", cumulative_nav: "1.933", price_change: "" },
  { price_date: "2026-07-08", nav: "1.195", cum_nav_withdrawal: "1.944", cumulative_nav: "1.944", price_change: "" },
]

const email = [
  { price_date: "2026-07-08", nav: "1.1950", cumulative_nav: null, adjusted_nav: null },
  { price_date: "2026-07-09", nav: "1.2150", cumulative_nav: null, adjusted_nav: null },
]

for (const [label, legacy] of [["broken", brokenLegacy], ["good", goodLegacy]] as const) {
  const merged = mergeNavSeriesWithEmail(legacy, email)
  console.log(`\n=== ${label} legacy + email ===`)
  for (const r of merged) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }
}

// No email — pure broken legacy
console.log("\n=== broken legacy only ===")
const legacyOnly = mergeNavSeriesWithEmail(brokenLegacy, [])
for (const r of legacyOnly) console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal)
