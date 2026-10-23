import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query.ts"
const out = mergeNavSeriesWithEmail(
  [
    { price_date: "2023-07-13", nav: "1.000000", cumulative_nav: "2.523000", cum_nav_withdrawal: "2.523000", price_change: "", legacy_origin: "fof99" },
    { price_date: "2023-07-14", nav: "0.999000", cumulative_nav: "2.520477", cum_nav_withdrawal: "2.522000", price_change: "", legacy_origin: "fof99" },
    { price_date: "2023-07-17", nav: "0.996000", cumulative_nav: "0.996000", cum_nav_withdrawal: "0.996000", price_change: "", legacy_origin: "platform" },
    { price_date: "2023-07-18", nav: "0.996000", cumulative_nav: "0.996000", cum_nav_withdrawal: "0.996000", price_change: "", legacy_origin: "platform" },
  ],
  [],
)
for (const r of out) console.log(r.price_date, r.nav, r.cumulative_nav, r.cum_nav_withdrawal)
