import { query } from "@/lib/db"
import type {
  CustomFundNavGenerationRule,
  FundSpliceEntry,
} from "@/lib/custom-fund-nav-rules-types"
import { replaceCustomFundNavRows } from "@/lib/server/custom-fund-nav"
import { loadMergedFundNavRows } from "@/lib/server/fund-nav-series"
import { loadPrivateFundLegacyNavRows, type LegacyNavRow } from "@/lib/server/email-nav-query"
import { findCustomFundByName } from "@/lib/server/custom-funds"
import {
  lookupManagedProductOverride,
  resolveManagedProductBeian,
} from "@/lib/server/managed-product-beian"
import {
  loadManagedProductNavSeed,
  mergeManagedProductDetailNav,
} from "@/lib/server/managed-product-nav-seed"
import { loadManagedProductEmailPoints, listTeamNavManageRows } from "@/lib/server/team-nav-manage-pg"

type AdjPoint = { date: string; adj: number }

function normalizeDate(value: string): string {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const m = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/)
  if (!m) return trimmed
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}

function fmtNav4(value: number): string {
  if (!Number.isFinite(value)) return ""
  return value.toFixed(4)
}

function legacyAdjustedNav(row: LegacyNavRow): number | null {
  const adj = parseFloat(row.cumulative_nav)
  if (Number.isFinite(adj) && adj > 0) return adj
  const unit = parseFloat(row.nav)
  if (Number.isFinite(unit) && unit > 0) return unit
  return null
}

function legacyRowsToPoints(rows: LegacyNavRow[]): AdjPoint[] {
  return rows.flatMap((row) => {
    const adj = legacyAdjustedNav(row)
    if (adj == null) return []
    return [{ date: row.price_date.slice(0, 10), adj }]
  })
}

async function lookupPrivateFundBeian(productName: string): Promise<{ beian_hao: string; short_name: string | null }> {
  const name = productName.trim()
  const rows = await query<{ beian_hao: string; short_name: string | null }>(
    `SELECT beian_hao, short_name
     FROM private_fund_info_bfl
     WHERE product_name = $1 OR short_name = $1
        OR product_name ILIKE $2 OR short_name ILIKE $2
     ORDER BY CASE WHEN product_name = $1 THEN 0 WHEN short_name = $1 THEN 1 ELSE 2 END
     LIMIT 1`,
    [name, `%${name}%`],
  ).catch(() => [] as { beian_hao: string; short_name: string | null }[])

  if (rows[0]?.beian_hao) return { beian_hao: rows[0].beian_hao, short_name: rows[0].short_name }

  const fallback = await query<{ beian_hao: string }>(
    `SELECT beian_hao FROM private_fund_info
     WHERE product_name = $1 OR product_name ILIKE $2
     ORDER BY CASE WHEN product_name = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [name, `%${name}%`],
  ).catch(() => [] as { beian_hao: string }[])

  if (!fallback[0]?.beian_hao) {
    throw new Error(`未找到私募基金「${name}」`)
  }
  return { beian_hao: fallback[0].beian_hao, short_name: null }
}

async function lookupCustomFundCode(productName: string): Promise<string> {
  const fund = findCustomFundByName(productName)
  if (!fund) throw new Error(`未找到自建基金「${productName}」`)
  return fund.product_code
}

async function lookupManagedProduct(productName: string): Promise<{ beian_hao: string; product_name: string }> {
  const override = lookupManagedProductOverride(productName)
  if (override) return { beian_hao: override.beian_hao, product_name: override.product_name }

  const rows = await query<{ beian_hao: string | null; product_name: string }>(
    `SELECT beian_hao, product_name
     FROM managed_products
     WHERE product_name = $1 OR product_name ILIKE $2
     ORDER BY CASE WHEN product_name = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [productName.trim(), `%${productName.trim()}%`],
  ).catch(() => [] as { beian_hao: string | null; product_name: string }[])

  if (!rows[0]) throw new Error(`未找到在管产品「${productName}」`)
  return {
    beian_hao: rows[0].beian_hao?.trim() || productName.trim(),
    product_name: rows[0].product_name,
  }
}

async function lookupFofUnderlying(productName: string): Promise<{ beian_hao: string; product_name: string }> {
  const rows = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name
     FROM investment_tracking_fof_underlying
     WHERE product_name = $1 OR product_name ILIKE $2 OR beian_hao = $1
     ORDER BY CASE WHEN product_name = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [productName.trim(), `%${productName.trim()}%`],
  ).catch(() => [] as { beian_hao: string; product_name: string }[])

  if (!rows[0]?.beian_hao) throw new Error(`未找到FOF底层「${productName}」`)
  return rows[0]
}

async function loadManagedProductAdjustedSeries(entry: FundSpliceEntry): Promise<AdjPoint[]> {
  const managed = await lookupManagedProduct(entry.product_name)
  const beian = resolveManagedProductBeian(managed.product_name, managed.beian_hao) ?? managed.beian_hao
  const seedRows = loadManagedProductNavSeed(beian)

  if (entry.nav_source === "团队净值") {
    const teamEmailPoints = await loadManagedProductEmailPoints({
      beian_hao: beian,
      product_name: managed.product_name,
      short_name: null,
    })
    const legacyRows = await loadPrivateFundLegacyNavRows(beian, managed.product_name, null, {
      excludeType6: true,
    })
    return legacyRowsToPoints(mergeManagedProductDetailNav(seedRows, teamEmailPoints, legacyRows))
  }

  return legacyRowsToPoints(await loadMergedFundNavRows(beian, managed.product_name, ""))
}

async function loadAdjustedSeries(entry: FundSpliceEntry): Promise<AdjPoint[]> {
  const name = entry.product_name.trim()
  if (!name) return []

  switch (entry.fund_category) {
    case "自建基金": {
      const code = await lookupCustomFundCode(name)
      const { listCustomFundNavSeries } = await import("@/lib/server/custom-fund-nav")
      return listCustomFundNavSeries(code).flatMap((row) => {
        const adj = parseFloat(row.cum_nav_withdrawal || row.cumulative_nav || row.nav)
        if (!Number.isFinite(adj) || adj <= 0) return []
        return [{ date: row.price_date.slice(0, 10), adj }]
      })
    }
    case "在管产品":
      return loadManagedProductAdjustedSeries(entry)
    case "FOF底层": {
      const fof = await lookupFofUnderlying(name)
      const rows = await loadMergedFundNavRows(fof.beian_hao, fof.product_name, "")
      return legacyRowsToPoints(rows)
    }
    default: {
      const beian = await lookupPrivateFundBeian(name)
      if (entry.nav_source === "团队净值") {
        const rows = await listTeamNavManageRows({
          beian_hao: beian.beian_hao,
          product_name: name,
          nav_type: "pre_fee",
        })
        return rows.flatMap((row) => {
          const adj = parseFloat(row.adjusted_nav ?? row.unit_nav)
          if (!Number.isFinite(adj) || adj <= 0) return []
          return [{ date: row.nav_date, adj }]
        })
      }
      const rows = await loadMergedFundNavRows(beian.beian_hao, name, beian.short_name ?? "")
      return legacyRowsToPoints(rows)
    }
  }
}

function fundSegmentBounds(
  fund: FundSpliceEntry,
  index: number,
  fundCount: number,
  fallbackStart: string,
  seriesLastDate: string,
): { start: string; end: string } {
  const start = normalizeDate(
    fund.start_date || (index === 0 ? fallbackStart : ""),
  )
  const rawEnd = fund.end_date || fund.tail_nav_date || ""
  const end = rawEnd
    ? normalizeDate(rawEnd)
    : index === fundCount - 1
      ? seriesLastDate
      : ""

  if (!start) {
    throw new Error(`请填写「${fund.product_name || `基金${index + 1}`}」的开始日期`)
  }
  if (!end) {
    throw new Error(`请填写「${fund.product_name || `基金${index + 1}`}」的结束日期`)
  }
  if (end < start) {
    throw new Error(`「${fund.product_name}」结束日期不能早于开始日期`)
  }
  return { start, end }
}

function computeSplicedNav(
  startDate: string,
  funds: FundSpliceEntry[],
  segments: AdjPoint[][],
): AdjPoint[] {
  const fallbackStart = normalizeDate(startDate)
  const output: AdjPoint[] = []

  for (let i = 0; i < funds.length; i += 1) {
    const points = [...segments[i]]
      .filter((p) => Number.isFinite(p.adj) && p.adj > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (!points.length) {
      throw new Error(`「${funds[i].product_name}」没有可用净值`)
    }

    const { start: segStart, end: segEnd } = fundSegmentBounds(
      funds[i],
      i,
      funds.length,
      fallbackStart,
      points[points.length - 1].date,
    )

    if (i === 0) {
      const segment = points.filter((p) => p.date >= segStart && p.date <= segEnd)
      if (!segment.length) {
        throw new Error(`「${funds[i].product_name}」在开始/结束日期范围内没有净值`)
      }
      output.push(...segment)
      continue
    }

    if (!output.length) {
      throw new Error("拼接序列为空，请检查第一只基金的开始/结束日期")
    }

    const prevEndDate = output[output.length - 1].date
    let lastOut = output[output.length - 1].adj
    let prevFundIdx = points.findIndex((p) => p.date > prevEndDate) - 1
    if (prevFundIdx < 0) {
      prevFundIdx = points.reduce((acc, p, idx) => (p.date <= prevEndDate ? idx : acc), -1)
    }

    const pushReturnPath = (fromIdx: number) => {
      for (let j = fromIdx; j < points.length; j += 1) {
        const prev = points[j - 1]
        const curr = points[j]
        if (curr.date < segStart || curr.date <= prevEndDate) continue
        if (curr.date > segEnd) break
        if (curr.adj <= 0 || prev.adj <= 0) continue
        lastOut = lastOut * (curr.adj / prev.adj)
        output.push({ date: curr.date, adj: lastOut })
      }
    }

    if (prevFundIdx < 0) {
      const firstAfter = points.findIndex(
        (p) => p.date > prevEndDate && p.date >= segStart && p.date <= segEnd,
      )
      if (firstAfter < 0) {
        throw new Error(
          `「${funds[i].product_name}」在切换日期（${prevEndDate}）之后、设定区间内没有净值`,
        )
      }
      output.push({ date: points[firstAfter].date, adj: lastOut })
      lastOut = output[output.length - 1].adj
      pushReturnPath(firstAfter + 1)
      continue
    }

    pushReturnPath(prevFundIdx + 1)

    if (output[output.length - 1].date <= prevEndDate) {
      throw new Error(
        `「${funds[i].product_name}」在切换日期之后、设定区间（${segStart}~${segEnd}）内没有净值`,
      )
    }
  }

  return output
}

function generateFixedIncomeNav(startDate: string, annualReturnRate: string): AdjPoint[] {
  const start = normalizeDate(startDate)
  const rate = parseFloat(annualReturnRate)
  if (!Number.isFinite(rate)) throw new Error("年化收益率格式不正确")

  const dailyRate = rate / 100 / 365
  const end = new Date().toISOString().slice(0, 10)
  const output: AdjPoint[] = []
  let current = new Date(`${start}T00:00:00Z`)
  const endDate = new Date(`${end}T00:00:00Z`)
  let nav = 1

  while (current <= endDate) {
    const date = current.toISOString().slice(0, 10)
    if (date >= start) {
      if (output.length > 0) {
        const prev = new Date(output[output.length - 1].date + "T00:00:00Z")
        const dayDiff = Math.round((current.getTime() - prev.getTime()) / 86_400_000)
        nav = nav * (1 + dailyRate * dayDiff)
      } else {
        nav = 1
      }
      output.push({ date, adj: nav })
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return output
}

export type GenerateNavResult =
  | { ok: true; count: number }
  | { ok: false; error: string }

export type SuggestTailResult =
  | {
      ok: true
      end_date: string
      /** @deprecated alias of end_date */
      tail_nav_date: string
      next_start_date: string
      fund1_last_date: string
      fund2_first_date: string
      hint: string
    }
  | { ok: false; error: string }

export type SuggestStartResult =
  | { ok: true; start_date: string; product_name: string }
  | { ok: false; error: string }

async function lookupInceptionByBeian(
  beianHao: string,
  productName?: string,
): Promise<string | null> {
  const code = beianHao.trim()
  if (!code) return null
  const name = (productName ?? "").trim()

  const [trackRows, bflRows, pfiRows] = await Promise.all([
    query<{ inception_date: string | null }>(
      `SELECT inception_date::text AS inception_date
       FROM basicinfo_bfl_track
       WHERE register_number = $1 OR record_key = $1
          OR ($2 <> '' AND (fund_name = $2 OR fund_short_name = $2))
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [code, name],
    ).catch(() => [] as { inception_date: string | null }[]),
    query<{ inception_date: string | null }>(
      `SELECT inception_date::text AS inception_date
       FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
      [code],
    ).catch(() => [] as { inception_date: string | null }[]),
    query<{ inception_date: string | null }>(
      `SELECT inception_date::text AS inception_date
       FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
      [code],
    ).catch(() => [] as { inception_date: string | null }[]),
  ])

  const pick = (value: string | null | undefined) => value?.slice(0, 10) || null
  return (
    pick(trackRows[0]?.inception_date)
    ?? pick(bflRows[0]?.inception_date)
    ?? pick(pfiRows[0]?.inception_date)
  )
}

async function lookupFundInceptionDate(entry: FundSpliceEntry): Promise<string | null> {
  const name = entry.product_name.trim()
  if (!name) return null

  switch (entry.fund_category) {
    case "自建基金": {
      const fund = findCustomFundByName(name)
      if (!fund) throw new Error(`未找到自建基金「${name}」`)
      const { listCustomFundNavSeries } = await import("@/lib/server/custom-fund-nav")
      const navSeries = listCustomFundNavSeries(fund.product_code)
      return normalizeDate(navSeries[0]?.price_date ?? fund.created_at.slice(0, 10))
    }
    case "在管产品": {
      const managed = await lookupManagedProduct(name)
      const beian = resolveManagedProductBeian(managed.product_name, managed.beian_hao) ?? managed.beian_hao
      return lookupInceptionByBeian(beian, managed.product_name)
    }
    case "FOF底层": {
      const fof = await lookupFofUnderlying(name)
      return lookupInceptionByBeian(fof.beian_hao, fof.product_name)
    }
    default: {
      const beian = await lookupPrivateFundBeian(name)
      return lookupInceptionByBeian(beian.beian_hao, name)
    }
  }
}

/** Resolve fund-1 inception date for auto-filling splice start date. */
export async function suggestSpliceStartDate(fund1: FundSpliceEntry): Promise<SuggestStartResult> {
  try {
    if (!fund1.product_name.trim()) {
      return { ok: false, error: "请先选择基金1" }
    }
    const inception = await lookupFundInceptionDate(fund1)
    if (!inception) {
      return { ok: false, error: `「${fund1.product_name}」未找到成立日期` }
    }
    return { ok: true, start_date: inception, product_name: fund1.product_name }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "获取成立日期失败" }
  }
}

/**
 * Suggest current fund end_date (= last NAV before next fund begins)
 * and next fund start_date for handoff.
 */
export async function suggestSpliceTailDate(
  startDate: string,
  fund1: FundSpliceEntry,
  fund2: FundSpliceEntry,
): Promise<SuggestTailResult> {
  try {
    const start = normalizeDate(startDate || fund1.start_date)
    if (!start) return { ok: false, error: "请先填写当前基金的开始日期" }
    if (!fund1.product_name.trim() || !fund2.product_name.trim()) {
      return { ok: false, error: "请先选择当前基金与下一只基金" }
    }

    const [seg1, seg2] = await Promise.all([
      loadAdjustedSeries(fund1),
      loadAdjustedSeries(fund2),
    ])
    const f1Dates = seg1.map((p) => p.date).filter((d) => d >= start).sort()
    const f2Dates = seg2.map((p) => p.date).sort()
    if (!f1Dates.length) {
      return { ok: false, error: `「${fund1.product_name}」在开始日期之后没有净值` }
    }
    if (!f2Dates.length) {
      return { ok: false, error: `「${fund2.product_name}」没有可用净值` }
    }

    const f2First = f2Dates.find((d) => d >= start) ?? f2Dates[0]
    const beforeF2 = f1Dates.filter((d) => d < f2First)
    const tail = beforeF2.length
      ? beforeF2[beforeF2.length - 1]
      : f1Dates.includes(f2First)
        ? f2First
        : f1Dates[f1Dates.length - 1]

    return {
      ok: true,
      end_date: tail,
      tail_nav_date: tail,
      next_start_date: f2First,
      fund1_last_date: tail,
      fund2_first_date: f2First,
      hint:
        tail === f2First
          ? `「${fund1.product_name}」与「${fund2.product_name}」在 ${tail} 同日衔接`
          : `「${fund1.product_name}」接至 ${tail}，「${fund2.product_name}」从 ${f2First} 起按收益率衔接`,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "自动选择失败" }
  }
}

export async function generateCustomFundNavFromRule(
  productCode: string,
  rule: Omit<CustomFundNavGenerationRule, "updated_at">,
): Promise<GenerateNavResult> {
  try {
    let points: AdjPoint[] = []

    if (rule.rule_type === "splice") {
      const activeFunds = rule.funds.filter((f) => f.product_name.trim())
      if (activeFunds.length < 2) {
        return { ok: false, error: "请至少选择两只基金" }
      }
      const seriesStart = activeFunds[0].start_date || rule.start_date
      if (!seriesStart.trim()) {
        return { ok: false, error: "请填写第一只基金的开始日期" }
      }
      const segments = await Promise.all(activeFunds.map((f) => loadAdjustedSeries(f)))
      points = computeSplicedNav(seriesStart, activeFunds, segments)
    } else if (rule.rule_type === "fixed_income") {
      points = generateFixedIncomeNav(rule.start_date, rule.annual_return_rate)
    } else {
      return { ok: false, error: "MOM多头净值规则生成功能暂未开放" }
    }

    if (!points.length) {
      return { ok: false, error: "未生成任何净值，请检查规则与数据源" }
    }

    replaceCustomFundNavRows(
      productCode,
      points.map((p) => ({ nav_date: p.date, unit_nav: fmtNav4(p.adj) })),
      "规则生成",
    )
    return { ok: true, count: points.length }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "净值生成失败",
    }
  }
}
