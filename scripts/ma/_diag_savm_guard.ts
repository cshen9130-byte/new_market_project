import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query.ts"

const savm = mergeNavSeriesWithEmail(
  [
    { price_date: "2026-07-01", nav: "0.7658", cum_nav_withdrawal: "1.5158", cumulative_nav: "1.5158", price_change: "" },
    { price_date: "2026-07-08", nav: "0.7279", cum_nav_withdrawal: "1.4769", cumulative_nav: "1.4769", price_change: "" },
    { price_date: "2026-07-09", nav: "0.7400", cum_nav_withdrawal: "1.4890", cumulative_nav: "1.4890", price_change: "" },
  ],
  [
    { price_date: "2026-07-08", nav: "1.1950", cumulative_nav: null, adjusted_nav: null },
    { price_date: "2026-07-09", nav: "1.2150", cumulative_nav: null, adjusted_nav: null },
  ],
)
for (const row of savm) console.log(row.price_date, row.nav, row.cum_nav_withdrawal, row.cumulative_nav)
