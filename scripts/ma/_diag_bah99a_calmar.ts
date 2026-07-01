import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const { computeOneYearRiskMetrics } = await import("@/lib/server/list-cache-nav-batch")
  const { computeFundNavMetrics } = await import("@/lib/fund-nav-metrics")
  const { selectEmailNavSeriesRows } = await import("@/lib/server/email-nav-query")

  const cache = await query(
    `SELECT unit_nav::text, nav_date::text, ret_1y::text, sharpe_1y::text, calmar_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'BAH99A'`,
  )
  console.log("tracking cache:", cache[0])

  const pinfo = await query(
    `SELECT sharpe_1y::text, calmar_1y::text, ret_1y::text, latest_nav_date::text
     FROM private_fund_info WHERE beian_hao = 'BAH99A'`,
  )
  console.log("private_fund_info:", pinfo[0])

  const rawRows = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            product_code, fund_name, attachment_filename, subject, source
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%恒盈2号%A%'
        OR BTRIM(product_code) = 'BAH99A'
     ORDER BY nav_date ASC, id ASC`,
  )
  const picked = selectEmailNavSeriesRows(rawRows as never[], "BAH99A", ["荣熙恒盈2号A类"])
  console.log("email series length:", picked.length, "range:", picked[0]?.nav_date, "→", picked.at(-1)?.nav_date)

  const refDate = picked.at(-1)!.nav_date
  const cutoffTs = new Date(refDate).getTime() - 365 * 86400000
  const window = picked.filter((r) => new Date(r.nav_date).getTime() >= cutoffTs)
  console.log("1Y window points:", window.length)

  const dates = window.map((r) => r.nav_date)
  const values = window.map((r) => parseFloat(r.nav))
  const risk1y = computeOneYearRiskMetrics(refDate, window.map((r) => ({ nav_date: r.nav_date, nav: parseFloat(r.nav) })))
  console.log("computed 1Y risk:", risk1y)

  const inception = computeFundNavMetrics({
    dates: picked.map((r) => r.nav_date),
    values: picked.map((r) => parseFloat(r.nav)),
  })
  console.log("since-inception metrics:", {
    calmar: inception?.calmar,
    maxDD: inception?.maxDD,
    periodRet: inception?.periodRet,
  })

  // legacy private_fund_nav
  const legacy = await query(
    `SELECT price_date::text AS nav_date, nav::text
     FROM private_fund_nav
     WHERE beian_hao = 'BAH99A'
     ORDER BY price_date DESC
     LIMIT 5`,
  )
  console.log("legacy private_fund_nav latest:", legacy)

  const type6 = await query(
    `SELECT price_date::text AS nav_date, nav::text
     FROM private_fund_nav_group_type6
     WHERE beian_hao = 'BAH99A'
     ORDER BY price_date ASC`,
  )
  console.log("type6 series length:", type6.length, "range:", type6[0]?.nav_date, "→", type6.at(-1)?.nav_date)
  if (type6.length >= 2) {
    const ref = type6.at(-1)!.nav_date
    const riskType6 = computeOneYearRiskMetrics(
      ref,
      type6.map((r) => ({ nav_date: r.nav_date, nav: parseFloat(r.nav) })),
    )
    const inceptionType6 = computeFundNavMetrics({
      dates: type6.map((r) => r.nav_date),
      values: type6.map((r) => parseFloat(r.nav)),
    })
    console.log("type6 1Y risk:", riskType6)
    console.log("type6 inception:", {
      calmar: inceptionType6?.calmar,
      maxDD: inceptionType6?.maxDD,
      periodRet: inceptionType6?.periodRet,
    })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
