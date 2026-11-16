/**
 * Display units for FOF底层 and the weekly-review pages.
 * Stored returns are ratios (0.0061). The pages multiply by 100.
 * This module returns percentage points (0.61 means 0.61%).
 */

import {
  WEEKLY_REVIEW_SOURCE_LABEL,
  WEEKLY_REVIEW_SOURCE_ORDER,
  weeklyReviewMetricLabel,
  type WeeklyReviewDataStatus,
  type WeeklyReviewSource,
} from "@/lib/weekly-review-data-status"

export function ratioToPct(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 10000) / 100
}

export function roundNum(value: unknown, digits: number): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(n)) return null
  const scale = 10 ** digits
  return Math.round(n * scale) / scale
}

export function sourceSummary(counts: Partial<Record<WeeklyReviewSource, number>> | null | undefined): string {
  if (!counts) return ""
  return WEEKLY_REVIEW_SOURCE_ORDER
    .filter((key) => (counts[key] ?? 0) > 0)
    .map((key) => `${WEEKLY_REVIEW_SOURCE_LABEL[key]} ${counts[key]}`)
    .join(" · ")
}

export function shapeWeeklyStatus(report: WeeklyReviewDataStatus) {
  return {
    variant: report.variant,
    variant_label: report.variant === "futures" ? "周度回顾(期货)" : "周度回顾(股票)",
    fund_count: report.fund_count,
    generated_at: report.generated_at,
    weeks: report.weeks,
    categories: report.categories.map((category) => ({
      bucket: category.bucket,
      mode: category.mode,
      mode_label: weeklyReviewMetricLabel(category.mode),
      product_count: category.total,
      weeks: category.weeks.map((week) => ({
        week_start: week.week_start,
        week_end: week.week_end,
        missing: week.missing,
        ready: week.missing === 0,
        missing_sources: sourceSummary(week.by_source),
      })),
    })),
  }
}

export type ReviewProduct = {
  reg_code: string
  name: string
  mode: "excess" | "absolute"
  week_pct: number | null
  ret_1w_pct: number | null
  ret_1m_pct: number | null
  ret_3m_pct: number | null
  ret_6m_pct: number | null
  ret_1y_pct: number | null
  excess_1w_pct: number | null
  excess_1m_pct: number | null
  excess_3m_pct: number | null
  excess_6m_pct: number | null
  excess_1y_pct: number | null
  excess_dd_6m_pct: number | null
  excess_dd_1y_pct: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
}

type Periods = {
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
}

export function shapeReviewProduct(row: {
  beian_hao: string
  name: string
  mode: "excess" | "absolute"
  ret: Periods
  excess: Periods
  excess_dd_6m: number | null
  excess_dd_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
}): ReviewProduct {
  const display = row.mode === "excess" ? row.excess : row.ret
  return {
    reg_code: row.beian_hao,
    name: row.name,
    mode: row.mode,
    week_pct: ratioToPct(display.ret_1w),
    ret_1w_pct: ratioToPct(row.ret.ret_1w),
    ret_1m_pct: ratioToPct(row.ret.ret_1m),
    ret_3m_pct: ratioToPct(row.ret.ret_3m),
    ret_6m_pct: ratioToPct(row.ret.ret_6m),
    ret_1y_pct: ratioToPct(row.ret.ret_1y),
    excess_1w_pct: ratioToPct(row.excess.ret_1w),
    excess_1m_pct: ratioToPct(row.excess.ret_1m),
    excess_3m_pct: ratioToPct(row.excess.ret_3m),
    excess_6m_pct: ratioToPct(row.excess.ret_6m),
    excess_1y_pct: ratioToPct(row.excess.ret_1y),
    excess_dd_6m_pct: ratioToPct(row.excess_dd_6m),
    excess_dd_1y_pct: ratioToPct(row.excess_dd_1y),
    sharpe_1y: roundNum(row.sharpe_1y, 2),
    calmar_1y: roundNum(row.calmar_1y, 2),
  }
}

export function medianPct(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value != null).sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  const value = nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
  return Math.round(value * 100) / 100
}

export function pickGroupHighlights(
  products: ReviewProduct[],
  opts: { q?: string; full?: boolean; top?: number; bottom?: number },
): { count: number; median_week_pct: number | null; products: ReviewProduct[]; truncated: boolean } {
  const q = (opts.q ?? "").trim().toLowerCase()
  const sorted = [...products].sort((a, b) => (b.week_pct ?? -Infinity) - (a.week_pct ?? -Infinity))
  if (q) {
    const matched = sorted.filter((row) => `${row.name} ${row.reg_code}`.toLowerCase().includes(q)).slice(0, 40)
    return {
      count: products.length,
      median_week_pct: medianPct(products.map((row) => row.week_pct)),
      products: matched,
      truncated: false,
    }
  }
  if (opts.full) {
    const cap = 120
    return {
      count: products.length,
      median_week_pct: medianPct(products.map((row) => row.week_pct)),
      products: sorted.slice(0, cap),
      truncated: sorted.length > cap,
    }
  }
  const topN = opts.top ?? 8
  const bottomN = opts.bottom ?? 3
  const top = sorted.slice(0, topN)
  const bottom = sorted.length > topN ? sorted.slice(-bottomN).reverse() : []
  const seen = new Set<string>()
  const picked: ReviewProduct[] = []
  for (const row of [...top, ...bottom]) {
    const key = `${row.reg_code}\0${row.name}`
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(row)
  }
  return {
    count: products.length,
    median_week_pct: medianPct(products.map((row) => row.week_pct)),
    products: picked,
    truncated: sorted.length > picked.length,
  }
}

export type FofListPayload = {
  data?: Array<Record<string, unknown>>
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
  totalMarketValue?: string | number | null
}

export function shapeFofUnderlyingPage(payload: FofListPayload) {
  const rows = (payload.data ?? []).map((row) => {
    const strategy = [row.strategy_l1, row.strategy_l2, row.strategy_l3]
      .map((part) => (part == null ? "" : String(part).trim()))
      .filter(Boolean)
      .join(" / ")
    const change = row.latest_change_date == null ? null : String(row.latest_change_date).slice(0, 10)
    return {
      product_name: String(row.short_name || row.product_name || ""),
      full_name: row.product_name == null ? null : String(row.product_name),
      reg_code: row.beian_hao == null ? null : String(row.beian_hao),
      strategy: strategy || null,
      first_entry_date: row.first_entry_date == null ? null : String(row.first_entry_date).slice(0, 10),
      latest_change_date: change,
      latest_nav_date: row.latest_nav_date == null ? null : String(row.latest_nav_date).slice(0, 10),
      latest_nav: roundNum(row.latest_nav, 4),
      price_change_pct: ratioToPct(row.latest_price_change),
      market_value: roundNum(row.market_value, 2),
      open_day: row.open_day == null || String(row.open_day).trim() === "" ? null : String(row.open_day),
      ret_1w_pct: ratioToPct(row.ret_1w),
      ret_1m_pct: ratioToPct(row.ret_1m),
      ret_3m_pct: ratioToPct(row.ret_3m),
      ret_6m_pct: ratioToPct(row.ret_6m),
      ret_1y_pct: ratioToPct(row.ret_1y),
      sharpe_1y: roundNum(row.sharpe_1y, 2),
      calmar_1y: roundNum(row.calmar_1y, 2),
    }
  })
  return {
    total: payload.total ?? rows.length,
    page: payload.page ?? 1,
    pagesize: payload.pageSize ?? rows.length,
    total_pages: payload.totalPages ?? 1,
    total_market_value: roundNum(payload.totalMarketValue, 2),
    rows,
  }
}

export function shapeExternalReturn(value: number | null | undefined): number | null {
  return ratioToPct(value)
}
