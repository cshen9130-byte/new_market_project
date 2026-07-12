import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query"

process.env.DEBUG_SBPC20_MERGE = "1"

const legacy = [
  { price_date: "2026-07-01", nav: "1.1805", cum_nav_withdrawal: "1.3936", cumulative_nav: "1.3936", price_change: "" },
  { price_date: "2026-07-02", nav: "1.1855", cum_nav_withdrawal: "1.1855", cumulative_nav: "1.1855", price_change: "" },
]
const email = [
  { price_date: "2026-07-01", nav: "1.180500", cumulative_nav: "1.393600", adjusted_nav: "1.393600" },
  { price_date: "2026-07-02", nav: "1.185500", cumulative_nav: "1.185500", adjusted_nav: null },
  { price_date: "2026-07-03", nav: "1.160600", cumulative_nav: "1.373700", adjusted_nav: "1.373700" },
]

const out = mergeNavSeriesWithEmail(legacy, email)
console.log("final Jul2", out.find((r) => r.price_date === "2026-07-02"))
