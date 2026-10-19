import {
  mergeLegacyWithTeamNav,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query.ts"

function assert(name, ok) {
  if (!ok) throw new Error(name)
  console.log("ok:", name)
}

{
  const legacy = [
    { price_date: "2026-05-22", nav: "1.8072", cumulative_nav: "3.330939", cum_nav_withdrawal: "2.5332", price_change: "" },
    { price_date: "2026-05-29", nav: "1.7908", cumulative_nav: "3.300711", cum_nav_withdrawal: "2.5168", price_change: "" },
  ]
  const teamIsolated = mergeNavSeriesWithEmail([], [
    { price_date: "2026-06-05", nav: "1.7917", cumulative_nav: "2.5177", adjusted_nav: null },
    { price_date: "2026-06-12", nav: "1.7878", cumulative_nav: "2.5138", adjusted_nav: null },
    { price_date: "2026-06-18", nav: "1.7944", cumulative_nav: "2.5204", adjusted_nav: null },
    { price_date: "2026-06-26", nav: "1.8531", cumulative_nav: "2.5791", adjusted_nav: null },
    { price_date: "2026-09-24", nav: "1.8601", cumulative_nav: "2.5861", adjusted_nav: null },
  ])
  const jun05Iso = teamIsolated.find((r) => r.price_date === "2026-06-05")
  assert(
    "GA681A isolated team collapses adj near cum",
    jun05Iso != null
      && Math.abs(parseFloat(jun05Iso.cumulative_nav) - parseFloat(jun05Iso.cum_nav_withdrawal)) < 0.05,
  )
  const merged = mergeLegacyWithTeamNav(legacy, teamIsolated, {
    beian_hao: "GA681A",
    product_name: "集微投资2期A类",
  })
  const may29 = merged.find((r) => r.price_date === "2026-05-29")
  const jun05 = merged.find((r) => r.price_date === "2026-06-05")
  const jun26 = merged.find((r) => r.price_date === "2026-06-26")
  const tip = merged.find((r) => r.price_date === "2026-09-24")
  const tipRatio = parseFloat(may29.cumulative_nav) / parseFloat(may29.cum_nav_withdrawal)
  assert("GA681A team adj rechains from legacy tip", jun05 != null && tip != null && jun26 != null)
  assert(
    "GA681A handoff keeps adj/cum ratio",
    Math.abs(parseFloat(jun05.cumulative_nav) / parseFloat(jun05.cum_nav_withdrawal) - tipRatio) < 0.01,
  )
  assert(
    "GA681A mid-team keeps adj/cum ratio",
    Math.abs(parseFloat(jun26.cumulative_nav) / parseFloat(jun26.cum_nav_withdrawal) - tipRatio) < 0.01,
  )
  assert(
    "GA681A tip adj stays on legacy premium (~3.39 not ~2.62)",
    parseFloat(tip.cumulative_nav) > 3.3
      && Math.abs(parseFloat(tip.cumulative_nav) / parseFloat(tip.cum_nav_withdrawal) - tipRatio) < 0.01,
  )
  assert(
    "GA681A invariant on merged tail",
    [jun05, jun26, tip].every((r) => {
      const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal), a = parseFloat(r.cumulative_nav)
      return a + 1e-6 >= c && c + 1e-6 >= u
    }),
  )
  console.log("tip", tip)
}

