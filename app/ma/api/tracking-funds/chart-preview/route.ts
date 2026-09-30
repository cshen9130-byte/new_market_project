import { NextResponse } from "next/server"
import { loadFundNavSeries, resolveFundNames } from "@/lib/server/fund-nav-series"
import { query } from "@/lib/db"
import {
  downsampleChartPoints,
  getChartPreviewMemoryCache,
  loadChartPreviewFromDetailCache,
  loadChartPreviewLiteNav,
  rememberChartPreviewMemoryCache,
  resolveChartPreviewNameLite,
  rowsToModeSeries,
} from "@/lib/server/chart-preview-nav"

export const dynamic = "force-dynamic"

// GET /ma/api/tracking-funds/chart-preview?beian_hao=XXX&days=90
// GET /ma/api/tracking-funds/chart-preview?beian_hao=XXX&from=2020-01-01&to=2024-12-31
// GET ...&mode=nav&lite=1  — hover sparkline: detail-cache / by-code SQL, no full merge
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const product_name = (searchParams.get("product_name") || "").trim()
  const from = (searchParams.get("from") || "").trim()
  const to = (searchParams.get("to") || "").trim()
  const days = Math.max(30, Math.min(3650, Number(searchParams.get("days") || 90)))
  const mode = (searchParams.get("mode") || "return").trim()
  const lite =
    searchParams.get("lite") === "1" ||
    searchParams.get("lite") === "true" ||
    searchParams.get("source") === "hover"
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  const useRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
  if (useRange && from > to) {
    return NextResponse.json({ fund: [], bench: [], error: "invalid date range" })
  }
  const opts = useRange ? { from, to } : { days }
  const cacheKey = [
    "chart-preview",
    beian_hao.toUpperCase(),
    product_name,
    useRange ? `${from}_${to}` : `d${days}`,
    mode,
    lite ? "lite" : "full",
  ].join("|")

  const mem = getChartPreviewMemoryCache(cacheKey)
  if (mem) return NextResponse.json(mem)

  // Hover / lite: prefer detail NAV cache, then by-code SQL (tens of ms).
  // Fall back to the full merge only when those yield too few points.
  if (lite) {
    const cached = await loadChartPreviewFromDetailCache(beian_hao, opts)
    let rows = cached?.rows ?? []
    let fundName = cached?.name ?? null
    if (rows.length < 2) {
      rows = await loadChartPreviewLiteNav(beian_hao, opts)
    }
    if (!fundName) {
      fundName = product_name || (await resolveChartPreviewNameLite(beian_hao))
    }

    let fund = rowsToModeSeries(rows, mode)
    // Full merge fallback for email-only / managed-seed funds with no platform rows.
    if (fund.length < 2) {
      const names = await resolveFundNames(beian_hao, product_name)
      fundName = names.product_name || fundName
      const navRows = await loadFundNavSeries(
        beian_hao,
        names.product_name,
        names.short_name,
        opts,
      )
      fund = rowsToModeSeries(
        navRows.flatMap((row) => {
          const level = parseFloat(row.level)
          if (!Number.isFinite(level) || level <= 0) return []
          return [{ price_date: row.price_date.slice(0, 10), level }]
        }),
        mode,
      )
    }

    fund = downsampleChartPoints(fund, 96)
    const needBench = mode === "return"
    const bench = needBench ? await loadBenchSeries(opts, useRange, from, to, days) : []
    const body = { fund, bench, name: fundName || beian_hao, lite: true }
    rememberChartPreviewMemoryCache(cacheKey, body)
    return NextResponse.json(body)
  }

  // Full path (fund compare / portfolio): reuse detail cache when possible.
  const cached = await loadChartPreviewFromDetailCache(beian_hao, opts)
  let fundName = product_name || cached?.name || ""
  let fund = cached ? rowsToModeSeries(cached.rows, mode) : []

  if (fund.length < 2) {
    const names = await resolveFundNames(beian_hao, product_name)
    fundName = names.product_name
    const navRows = await loadFundNavSeries(
      beian_hao,
      names.product_name,
      names.short_name,
      opts,
    )
    fund = rowsToModeSeries(
      navRows.flatMap((row) => {
        const level = parseFloat(row.level)
        if (!Number.isFinite(level) || level <= 0) return []
        return [{ price_date: row.price_date.slice(0, 10), level }]
      }),
      mode,
    )
  } else if (!fundName) {
    fundName = await resolveChartPreviewNameLite(beian_hao)
  }

  const needBench = mode === "return"
  const bench = needBench ? await loadBenchSeries(opts, useRange, from, to, days) : []
  const body = { fund, bench, name: fundName || beian_hao }
  rememberChartPreviewMemoryCache(cacheKey, body)
  return NextResponse.json(body)
}

async function loadBenchSeries(
  _opts: { from: string; to: string } | { days: number },
  useRange: boolean,
  from: string,
  to: string,
  days: number,
): Promise<{ d: string; v: number }[]> {
  const benchRows = await query<{ trade_date: string; value: string }>(
    `SELECT trade_date::text AS trade_date, value::text
     FROM raw_etf_daily
     WHERE ticker = '510300.SH' AND field = 'ORIGINALUNIT'
       AND ${useRange ? "trade_date >= $1::date AND trade_date <= $2::date" : "trade_date >= CURRENT_DATE - ($1::int)"}
     ORDER BY trade_date ASC`,
    useRange ? [from, to] : [days],
  ).catch(() => [] as { trade_date: string; value: string }[])

  const bench: { d: string; v: number }[] = []
  if (benchRows.length === 0) return bench
  const firstVal = parseFloat(benchRows[0].value)
  if (!Number.isFinite(firstVal) || firstVal <= 0) return bench
  for (const row of benchRows) {
    const val = parseFloat(row.value)
    if (!Number.isFinite(val)) continue
    bench.push({
      d: row.trade_date.slice(0, 10),
      v: parseFloat(((val / firstVal - 1) * 100).toFixed(4)),
    })
  }
  return bench
}
