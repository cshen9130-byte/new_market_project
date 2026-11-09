import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { countChinaTradingDaysInclusive } from "@/lib/server/china-trading-calendar"

export type PublicEnhancedSearchHit = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
  has_nav: boolean
}

type ShareRow = {
  choice_code: string
  fund_code: string
  short_name: string | null
  full_name: string | null
  benchmark_index: string | null
  inception_date: string | null
  manager_company: string | null
  fund_manager: string | null
  aum_yi: string | null
  nav_row_count: number | null
}

type NavDbRow = {
  nav_date: string
  unit_nav: string | null
  accumulated_nav: string | null
  rehabilitation_nav: string | null
}

const PUBLIC_FUND_ID = /^\d{6}(?:\.(?:SZ|SH|OF))?$/i

function missingTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes("does not exist") && message.includes("public_enhanced_index")
}

function strategyLabel(benchmark: string | null): string {
  const text = (benchmark ?? "").trim()
  return text ? `公募指增·${text}` : "公募指增"
}

export async function searchPublicEnhancedIndexFunds(
  q: string,
  limit: number,
): Promise<PublicEnhancedSearchHit[]> {
  const trimmed = q.trim()
  if (!trimmed || limit <= 0) return []
  const like = `%${trimmed}%`
  const prefix = `${trimmed}%`
  try {
    const rows = await query<ShareRow & { has_nav: boolean }>(
      `SELECT
         choice_code,
         fund_code,
         short_name,
         full_name,
         benchmark_index,
         (COALESCE(nav_row_count, 0) > 0) AS has_nav
       FROM public_enhanced_index_share
       WHERE short_name ILIKE $1
          OR full_name ILIKE $1
          OR fund_code ILIKE $1
          OR choice_code ILIKE $1
       ORDER BY
         CASE
           WHEN fund_code ILIKE $2 OR choice_code ILIKE $2 THEN 0
           WHEN short_name ILIKE $2 OR full_name ILIKE $2 THEN 1
           ELSE 2
         END,
         is_etf DESC,
         LENGTH(COALESCE(short_name, full_name, '')) ASC,
         choice_code ASC
       LIMIT $3`,
      [like, prefix, limit],
    )
    const needle = trimmed.toLowerCase()
    return rows.map((row) => {
      const short = row.short_name ?? ""
      const full = row.full_name ?? ""
      const shown = short.toLowerCase().includes(needle)
        ? short
        : full.toLowerCase().includes(needle)
          ? full
          : (short || full)
      return {
        beian_hao: row.choice_code,
        product_name: full || short || row.choice_code,
        short_name: shown || null,
        strategy_one: strategyLabel(row.benchmark_index),
        has_nav: row.has_nav === true,
      }
    })
  } catch (err) {
    if (!missingTable(err)) console.error("[public-enhanced-index] search", err)
    return []
  }
}

function num(value: string | null): number | null {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function metricsFromSeries(series: Array<{ price_date: string; nav: string; cumulative_nav: string; cum_nav_withdrawal: string }>) {
  const first = series[0]
  const latest = series[series.length - 1]
  const latestRehab = latest ? num(latest.cumulative_nav) : null
  const firstRehab = first ? num(first.cumulative_nav) : null
  const retSince = latestRehab != null && firstRehab != null && firstRehab > 0
    ? latestRehab / firstRehab - 1
    : null
  const tradingDays = first && latest
    ? countChinaTradingDaysInclusive(first.price_date, latest.price_date)
    : 0
  const ann = retSince != null && tradingDays >= 1
    ? Math.pow(1 + retSince, 252 / tradingDays) - 1
    : null
  const yearStart = latest ? `${latest.price_date.slice(0, 4)}-01-01` : null
  const ytdBase = yearStart
    ? [...series].reverse().find((row) => row.price_date < yearStart)
      ?? series.find((row) => row.price_date >= yearStart)
      ?? null
    : null
  const ytd = ytdBase && latestRehab != null && num(ytdBase.cumulative_nav)
    ? latestRehab / num(ytdBase.cumulative_nav)! - 1
    : null
  let peak = -Infinity
  let maxDrawdown = 0
  const daily: number[] = []
  for (let i = 0; i < series.length; i++) {
    const value = num(series[i].cumulative_nav)
    if (value == null) continue
    if (value > peak) peak = value
    const dd = peak > 0 ? (peak - value) / peak : 0
    if (dd > maxDrawdown) maxDrawdown = dd
    if (i > 0) {
      const prev = num(series[i - 1].cumulative_nav)
      if (prev != null && prev > 0) daily.push(value / prev - 1)
    }
  }
  let sharpe: string | null = null
  if (ann != null && daily.length > 1 && tradingDays >= 1) {
    const recordsPerYear = daily.length / (tradingDays / 252)
    const mean = daily.reduce((sum, ret) => sum + ret, 0) / daily.length
    const variance = daily.reduce((sum, ret) => sum + (ret - mean) ** 2, 0) / daily.length
    const annVol = Math.sqrt(variance) * Math.sqrt(recordsPerYear)
    if (annVol > 0) sharpe = (ann / annVol).toFixed(2)
  }
  const pct = (value: number | null) => (value == null ? null : (value * 100).toFixed(2))
  return {
    latest_nav: latest?.nav ?? null,
    latest_nav_date: latest?.price_date ?? null,
    latest_cum_nav: latest?.cum_nav_withdrawal ?? null,
    latest_cum_nav_reinvested: latest?.cumulative_nav ?? null,
    ret_since_inception: pct(retSince),
    ann_ret: pct(ann),
    ytd_ret: pct(ytd),
    max_drawdown: maxDrawdown > 0 ? (maxDrawdown * 100).toFixed(2) : null,
    sharpe_since_inception: sharpe,
  }
}

async function loadShare(rawId: string): Promise<ShareRow | null> {
  const id = rawId.trim()
  if (!PUBLIC_FUND_ID.test(id)) return null
  const rows = await query<ShareRow>(
    `SELECT
       choice_code,
       fund_code,
       short_name,
       full_name,
       benchmark_index,
       inception_date::text AS inception_date,
       manager_company,
       fund_manager,
       aum_yi::text AS aum_yi,
       nav_row_count
     FROM public_enhanced_index_share
     WHERE UPPER(choice_code) = UPPER($1)
        OR fund_code = $1
     ORDER BY
       CASE WHEN UPPER(choice_code) = UPPER($1) THEN 0 ELSE 1 END,
       is_etf DESC,
       choice_code ASC
     LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

/** Detail payload for a Choice 公募指增 code, or null when this id is not one. */
export async function publicEnhancedIndexDetailResponse(rawId: string): Promise<NextResponse | null> {
  let share: ShareRow | null
  try {
    share = await loadShare(rawId)
  } catch (err) {
    if (!missingTable(err)) console.error("[public-enhanced-index] detail", err)
    return null
  }
  if (!share) return null

  const navRows = await query<NavDbRow>(
    `SELECT
       nav_date::text AS nav_date,
       unit_nav::text AS unit_nav,
       accumulated_nav::text AS accumulated_nav,
       rehabilitation_nav::text AS rehabilitation_nav
     FROM public_enhanced_index_nav
     WHERE choice_code = $1
     ORDER BY nav_date ASC`,
    [share.choice_code],
  )

  let prevRehab: number | null = null
  const nav_series = navRows.flatMap((row) => {
    const unit = num(row.unit_nav)
    const rehab = num(row.rehabilitation_nav) ?? unit
    const accum = num(row.accumulated_nav) ?? unit
    if (unit == null || rehab == null || accum == null) return []
    const priceChange = prevRehab != null && prevRehab > 0
      ? ((rehab / prevRehab - 1) * 100).toFixed(4)
      : ""
    prevRehab = rehab
    return [{
      price_date: row.nav_date,
      nav: String(unit),
      cumulative_nav: String(rehab),
      cum_nav_withdrawal: String(accum),
      price_change: priceChange,
    }]
  })

  const name = share.full_name || share.short_name || share.choice_code
  const aum = num(share.aum_yi)
  return NextResponse.json({
    is_public_enhanced_index: true,
    partial: false,
    info: {
      beian_hao: share.choice_code,
      product_name: name,
      short_name: share.short_name,
      strategy_l1: "公募指增",
      strategy_l2: share.benchmark_index,
      strategy_l3: null,
      manager: share.manager_company ?? "",
      manager_names: share.fund_manager,
      scale: aum != null ? `${aum}亿` : null,
      inception_date: share.inception_date,
      operation_date: null,
      benchmark: share.benchmark_index,
      ret_1w: null,
      ret_1m: null,
      ret_3m: null,
      ret_6m: null,
      ret_1y: null,
      sharpe_1y: null,
      calmar_1y: null,
    },
    nav_series,
    nav_data_source: "platform",
    metrics: metricsFromSeries(nav_series),
  })
}
