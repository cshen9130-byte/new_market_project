import { query } from "@/lib/db"
import type {
  CustomFundNavGenerationRule,
  FundSpliceEntry,
} from "@/lib/custom-fund-nav-rules-types"
import { replaceCustomFundNavRows } from "@/lib/server/custom-fund-nav"
import { loadMergedFundNavRows } from "@/lib/server/fund-nav-series"
import type { LegacyNavRow } from "@/lib/server/email-nav-query"
import { findCustomFundByName } from "@/lib/server/custom-funds"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { loadManagedProductNavSeries, listTeamNavManageRows } from "@/lib/server/team-nav-manage-pg"

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
    case "在管产品": {
      const managed = await lookupManagedProduct(name)
      const rows = await loadManagedProductNavSeries({
        beian_hao: managed.beian_hao,
        product_name: managed.product_name,
        short_name: null,
      })
      return legacyRowsToPoints(rows)
    }
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

function computeSplicedNav(
  startDate: string,
  funds: FundSpliceEntry[],
  segments: AdjPoint[][],
): AdjPoint[] {
  const start = normalizeDate(startDate)
  const output: AdjPoint[] = []

  for (let i = 0; i < funds.length; i += 1) {
    const points = [...segments[i]]
      .filter((p) => Number.isFinite(p.adj) && p.adj > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (!points.length) {
      throw new Error(`「${funds[i].product_name}」没有可用净值`)
    }

    if (i === 0) {
      const tail = funds[i].tail_nav_date
        ? normalizeDate(funds[i].tail_nav_date)
        : points[points.length - 1].date
      const segment = points.filter((p) => p.date >= start && p.date <= tail)
      if (!segment.length) {
        throw new Error(`「${funds[i].product_name}」在拼接开始/尾部日期范围内没有净值`)
      }
      output.push(...segment)
      continue
    }

    if (!output.length) {
      throw new Error("拼接序列为空，请检查第一只基金的开始时间与尾部净值日期")
    }

    const prevEndDate = output[output.length - 1].date
    let lastOut = output[output.length - 1].adj
    let prevFundIdx = points.findIndex((p) => p.date > prevEndDate) - 1
    if (prevFundIdx < 0) {
      prevFundIdx = points.reduce((acc, p, idx) => (p.date <= prevEndDate ? idx : acc), -1)
    }
    if (prevFundIdx < 0) {
      throw new Error(`「${funds[i].product_name}」缺少拼接切换前的净值`)
    }

    for (let j = prevFundIdx + 1; j < points.length; j += 1) {
      const prev = points[j - 1]
      const curr = points[j]
      if (curr.adj <= 0 || prev.adj <= 0) continue
      lastOut = lastOut * (curr.adj / prev.adj)
      output.push({ date: curr.date, adj: lastOut })
    }

    if (output[output.length - 1].date <= prevEndDate) {
      throw new Error(`「${funds[i].product_name}」在切换日期之后没有净值`)
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
      const segments = await Promise.all(activeFunds.map((f) => loadAdjustedSeries(f)))
      points = computeSplicedNav(rule.start_date, activeFunds, segments)
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
