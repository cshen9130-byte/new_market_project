import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "product_name",
  latest_nav: "latest_unit_nav",
  latest_nav_date: "latest_nav_date",
  latest_price_change: "latest_return_pct",
  custody_balance: "custody_account_balance",
  net_asset_value: "net_asset_value",
  ret_1w: "ret_1w",
  ret_1m: "ret_1m",
  ret_3m: "ret_3m",
  ret_6m: "ret_6m",
  ret_1y: "ret_1y",
  sharpe_1y: "sharpe_1y",
  calmar_1y: "calmar_1y",
}

const BEIAN_EXPR = "COALESCE(b.beian_hao, o.register_number)"
const PRODUCT_EXPR = "m.product_name"
const SHORT_EXPR = "COALESCE(b.short_name, o.fund_short_name)"

function managedNavScalarExpr(days: number, cutoffExpr: string): string {
  return `COALESCE(
    (SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
     WHERE ngc.beian_hao = ${BEIAN_EXPR} AND ${BEIAN_EXPR} IS NOT NULL
       AND ngc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngc.price_date DESC LIMIT 1),
    (SELECT ngn.nav::numeric FROM private_fund_nav_group ngn
     WHERE ngn.product_name = ${PRODUCT_EXPR}
       AND ngn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngn.price_date DESC LIMIT 1),
    (SELECT ngs.nav::numeric FROM private_fund_nav_group ngs
     WHERE ${SHORT_EXPR} IS NOT NULL AND ngs.product_name = ${SHORT_EXPR}
       AND ngs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngs.price_date DESC LIMIT 1),
    (SELECT nhc.nav::numeric FROM private_fund_nav_group_hy nhc
     WHERE nhc.beian_hao = ${BEIAN_EXPR} AND ${BEIAN_EXPR} IS NOT NULL
       AND nhc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhc.price_date DESC LIMIT 1),
    (SELECT nhn.nav::numeric FROM private_fund_nav_group_hy nhn
     WHERE nhn.product_name = ${PRODUCT_EXPR}
       AND nhn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhn.price_date DESC LIMIT 1),
    (SELECT nhs.nav::numeric FROM private_fund_nav_group_hy nhs
     WHERE ${SHORT_EXPR} IS NOT NULL AND nhs.product_name = ${SHORT_EXPR}
       AND nhs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhs.price_date DESC LIMIT 1),
    (SELECT nfc.nav::numeric FROM private_fund_nav nfc
     WHERE nfc.beian_hao = ${BEIAN_EXPR} AND ${BEIAN_EXPR} IS NOT NULL
       AND nfc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfc.price_date DESC LIMIT 1),
    (SELECT nfn.nav::numeric FROM private_fund_nav nfn
     WHERE nfn.product_name = ${PRODUCT_EXPR}
       AND nfn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfn.price_date DESC LIMIT 1),
    (SELECT nfs.nav::numeric FROM private_fund_nav nfs
     WHERE ${SHORT_EXPR} IS NOT NULL AND nfs.product_name = ${SHORT_EXPR}
       AND nfs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfs.price_date DESC LIMIT 1)
  )`
}

function navAtOffset(alias: string, days: number, cutoffExpr: string): string {
  return `LEFT JOIN LATERAL (
    SELECT ${managedNavScalarExpr(days, cutoffExpr)} AS nav
  ) ${alias} ON true`
}

interface ManagedRow {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  custody_balance: string | null
  net_asset_value: string | null
  valuation_date: string | null
  ret_1w?: string | null
  ret_1m?: string | null
  ret_3m?: string | null
  ret_6m?: string | null
  ret_1y?: string | null
  sharpe_1y?: string | null
  calmar_1y?: string | null
}

interface NavSeriesPoint {
  price_date: string
  level: string | null
}

function std(values: number[]): number {
  if (values.length <= 1) return NaN
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function median(values: number[]): number {
  if (values.length === 0) return NaN
  const arr = [...values].sort((a, b) => a - b)
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid]
}

function calcOneYearRatios(points: NavSeriesPoint[]) {
  if (points.length < 3) return { sharpe_1y: null, calmar_1y: null }
  const byDate = new Map<string, { ts: number; level: number }>()
  for (const p of points) {
    const ts = new Date(p.price_date).getTime()
    const level = p.level ? parseFloat(p.level) : NaN
    if (!Number.isFinite(ts) || !Number.isFinite(level) || level <= 0) continue
    byDate.set(p.price_date, { ts, level })
  }
  const series = Array.from(byDate.values()).sort((a, b) => a.ts - b.ts)
  if (series.length < 3) return { sharpe_1y: null, calmar_1y: null }
  const first = series[0]
  const last = series[series.length - 1]
  const days = (last.ts - first.ts) / 86_400_000
  if (!Number.isFinite(days) || days <= 0) return { sharpe_1y: null, calmar_1y: null }
  const periodRet = last.level / first.level - 1
  if (!Number.isFinite(periodRet) || periodRet <= -1) return { sharpe_1y: null, calmar_1y: null }
  const annRet = Math.pow(1 + periodRet, 365 / days) - 1
  const periodicRets: number[] = []
  const gaps: number[] = []
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]
    const curr = series[i]
    if (prev.level > 0) periodicRets.push(curr.level / prev.level - 1)
    const gap = (curr.ts - prev.ts) / 86_400_000
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap)
  }
  const medGap = median(gaps)
  const periodsPerYear = !Number.isFinite(medGap) ? 52 : medGap <= 2 ? 252 : medGap <= 10 ? 52 : medGap <= 20 ? 26 : medGap <= 45 ? 12 : 4
  const vol = periodicRets.length > 1 ? std(periodicRets) * Math.sqrt(periodsPerYear) : NaN
  let peak = series[0].level
  let maxDrawdown = 0
  for (const p of series) {
    if (p.level > peak) peak = p.level
    const dd = peak > 0 ? (peak - p.level) / peak : 0
    if (dd > maxDrawdown) maxDrawdown = dd
  }
  const sharpe = Number.isFinite(vol) && vol > 0 ? annRet / vol : NaN
  const calmar = maxDrawdown > 0 ? annRet / maxDrawdown : NaN
  return {
    sharpe_1y: Number.isFinite(sharpe) ? sharpe.toFixed(2) : null,
    calmar_1y: Number.isFinite(calmar) ? calmar.toFixed(2) : null,
  }
}

async function loadOneYearSeries(beianHao: string, productName: string, shortName: string | null): Promise<NavSeriesPoint[]> {
  return query<NavSeriesPoint>(
    `WITH candidates AS (
       SELECT 1 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
       FROM private_fund_nav_group WHERE beian_hao = $1
       UNION ALL SELECT 2, price_date, COALESCE(cumulative_nav, nav)::numeric FROM private_fund_nav_group WHERE $2 <> '' AND product_name = $2
       UNION ALL SELECT 3, price_date, COALESCE(cumulative_nav, nav)::numeric FROM private_fund_nav_group WHERE $3 <> '' AND product_name = $3
       UNION ALL SELECT 4, price_date, COALESCE(cumulative_nav, nav)::numeric FROM private_fund_nav_group_hy WHERE beian_hao = $1
       UNION ALL SELECT 5, price_date, COALESCE(cumulative_nav, nav)::numeric FROM private_fund_nav_group_hy WHERE $2 <> '' AND product_name = $2
       UNION ALL SELECT 6, price_date, COALESCE(cumulative_nav, nav)::numeric FROM private_fund_nav_group_hy WHERE $3 <> '' AND product_name = $3
       UNION ALL SELECT 7, price_date, COALESCE(cumulative_nav, nav)::numeric FROM private_fund_nav WHERE beian_hao = $1
       UNION ALL SELECT 8, price_date, COALESCE(cumulative_nav, nav)::numeric FROM private_fund_nav WHERE $2 <> '' AND product_name = $2
       UNION ALL SELECT 9, price_date, COALESCE(cumulative_nav, nav)::numeric FROM private_fund_nav WHERE $3 <> '' AND product_name = $3
     ), best AS (SELECT MIN(pri) AS pri FROM candidates)
     SELECT c.price_date::text AS price_date, c.level::text AS level
     FROM candidates c JOIN best b ON c.pri = b.pri
     WHERE c.price_date >= CURRENT_DATE - INTERVAL '370 days'
     ORDER BY c.price_date ASC`,
    [beianHao, productName ?? "", shortName ?? ""],
  )
}

async function addManagedRiskMetrics(rows: ManagedRow[]): Promise<ManagedRow[]> {
  if (rows.length === 0) return rows
  const out: ManagedRow[] = []
  for (let i = 0; i < rows.length; i += 8) {
    const batch = rows.slice(i, i + 8)
    const enriched = await Promise.all(
      batch.map(async (row) => {
        if (!row.beian_hao) return { ...row, sharpe_1y: null, calmar_1y: null }
        const series = await loadOneYearSeries(row.beian_hao, row.product_name, row.short_name)
        return { ...row, ...calcOneYearRatios(series) }
      }),
    )
    out.push(...enriched)
  }
  return out
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset = (page - 1) * pageSize
    const keyword = (searchParams.get("keyword") || "").trim()
    const strategySource = searchParams.get("strategy_source") === "platform" ? "platform" : "company"
    const strategyL1 = (searchParams.get("strategy_l1") || "").trim()
    const runStatus = searchParams.get("run_status") || "running"
    const teamTagMode = searchParams.get("team_tag_mode") === "or" ? "or" : "and"
    const teamTags = searchParams.getAll("team_tag").map((t) => t.trim()).filter(Boolean)
    const sortParam = searchParams.get("sort") || ""
    const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "sequence_no"
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const sortCol = sortKey === "sequence_no" ? "sequence_no" : ALLOWED_SORT[sortKey]
    const cutoffRaw = (searchParams.get("cutoff") || "").trim()
    const hasCutoff = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)

    const strategyCol = strategySource === "platform" ? "o.platform_strategy_one" : "o.company_strategy_one"
    const strategyExpr = `COALESCE(NULLIF(BTRIM(${strategyCol}), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`
    const teamTagsExpr = `CASE WHEN jsonb_typeof(o.tag->'company') = 'array' THEN o.tag->'company' ELSE '[]'::jsonb END`

    const conditions: string[] = ["m.product_name <> '合计'"]
    const params: unknown[] = []
    let pi = 1

    if (keyword) {
      conditions.push(`(
        m.product_name ILIKE $${pi}
        OR COALESCE(b.beian_hao, o.register_number, '') ILIKE $${pi}
      )`)
      params.push(`%${keyword}%`)
      pi++
    }

    if (strategyL1 === "__unconfigured__") {
      conditions.push(`${strategyExpr} IS NULL`)
    } else if (strategyL1) {
      conditions.push(`${strategyExpr} = $${pi}`)
      params.push(strategyL1)
      pi++
    }

    if (runStatus === "running") {
      conditions.push(`COALESCE(m.net_asset_value, 0) > 0`)
    } else if (runStatus === "liquidated") {
      conditions.push(`COALESCE(m.net_asset_value, 0) <= 0`)
    }

    if (teamTags.length > 0) {
      if (teamTagMode === "or") {
        conditions.push(`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${teamTagsExpr}) AS tag_values(tag_value)
          WHERE BTRIM(tag_value) = ANY($${pi}::text[])
        )`)
        params.push(teamTags)
        pi++
      } else {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM unnest($${pi}::text[]) AS req(tag)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${teamTagsExpr}) AS tag_values(tag_value)
            WHERE BTRIM(tag_value) = req.tag
          )
        )`)
        params.push(teamTags)
        pi++
      }
    }

    const where = conditions.join(" AND ")

    const baseFrom = `
      FROM managed_products m
      LEFT JOIN LATERAL (
        SELECT beian_hao, short_name, strategy_company
        FROM private_fund_info_bfl
        WHERE product_name = m.product_name OR short_name = m.product_name
        LIMIT 1
      ) b ON true
      LEFT JOIN LATERAL (
        SELECT register_number, fund_short_name, company_strategy_one, platform_strategy_one, tag
        FROM type6_ops_team_full
        WHERE fund_name = m.product_name OR fund_short_name = m.product_name
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1
      ) o ON true
    `

    const [countRows, totalNavRows] = await Promise.all([
      query<{ n: string }>(`SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`, params),
      query<{ total_nav: string }>(
        `SELECT COALESCE(SUM(m.net_asset_value), 0)::text AS total_nav ${baseFrom} WHERE ${where}`,
        params,
      ),
    ])
    const total = parseInt(countRows[0]?.n || "0", 10)
    const totalNetAssetValue = totalNavRows[0]?.total_nav ?? "0"

    const listParams = [...params]
    let cutoffExpr = "CURRENT_DATE"
    if (hasCutoff) {
      listParams.push(cutoffRaw)
      cutoffExpr = `$${listParams.length}::date`
    }
    const currentNavExpr = "m.latest_unit_nav::numeric"
    const histJoins = [
      navAtOffset("h1w", 7, cutoffExpr),
      navAtOffset("h1m", 30, cutoffExpr),
      navAtOffset("h3m", 90, cutoffExpr),
      navAtOffset("h6m", 180, cutoffExpr),
      navAtOffset("h1y", 365, cutoffExpr),
    ].join("\n")

    const rows = await query<{
      id: string
      beian_hao: string | null
      product_name: string
      short_name: string | null
      strategy_l1: string | null
      latest_unit_nav: string | null
      latest_nav_date: string | Date | null
      latest_return_pct: string | null
      custody_account_balance: string | null
      net_asset_value: string | null
      sequence_no: number | null
      ret_1w: string | null
      ret_1m: string | null
      ret_3m: string | null
      ret_6m: string | null
      ret_1y: string | null
    }>(
      `SELECT * FROM (
         SELECT
           m.id::text AS id,
           m.sequence_no,
           ${BEIAN_EXPR} AS beian_hao,
           m.product_name,
           COALESCE(b.short_name, o.fund_short_name, m.product_name) AS short_name,
           ${strategyExpr} AS strategy_l1,
           m.latest_unit_nav::text AS latest_unit_nav,
           m.latest_nav_date,
           m.latest_return_pct::text AS latest_return_pct,
           m.custody_account_balance::text AS custody_account_balance,
           m.net_asset_value::text AS net_asset_value,
           CASE WHEN h1w.nav IS NOT NULL AND h1w.nav <> 0
             THEN ((${currentNavExpr}) / h1w.nav - 1)::text END AS ret_1w,
           CASE WHEN h1m.nav IS NOT NULL AND h1m.nav <> 0
             THEN ((${currentNavExpr}) / h1m.nav - 1)::text END AS ret_1m,
           CASE WHEN h3m.nav IS NOT NULL AND h3m.nav <> 0
             THEN ((${currentNavExpr}) / h3m.nav - 1)::text END AS ret_3m,
           CASE WHEN h6m.nav IS NOT NULL AND h6m.nav <> 0
             THEN ((${currentNavExpr}) / h6m.nav - 1)::text END AS ret_6m,
           CASE WHEN h1y.nav IS NOT NULL AND h1y.nav <> 0
             THEN ((${currentNavExpr}) / h1y.nav - 1)::text END AS ret_1y
         ${baseFrom}
         ${histJoins}
         WHERE ${where}
       ) rows
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, sequence_no ASC
       LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
      [...listParams, pageSize, offset],
    )

    let data: ManagedRow[] = rows.map((r) => ({
      id: r.id,
      beian_hao: r.beian_hao,
      product_name: r.product_name,
      short_name: r.short_name,
      strategy_l1: r.strategy_l1,
      latest_nav: r.latest_unit_nav,
      latest_nav_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
      latest_price_change: r.latest_return_pct != null ? String(parseFloat(r.latest_return_pct) / 100) : null,
      custody_balance: r.custody_account_balance,
      net_asset_value: r.net_asset_value,
      valuation_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
      ret_1w: r.ret_1w,
      ret_1m: r.ret_1m,
      ret_3m: r.ret_3m,
      ret_6m: r.ret_6m,
      ret_1y: r.ret_1y,
    }))

    data = await addManagedRiskMetrics(data)

    if (sortKey === "sharpe_1y" || sortKey === "calmar_1y") {
      const asc = sortDir === "ASC"
      data = [...data].sort((a, b) => {
        const av = a[sortKey] != null ? parseFloat(a[sortKey] as string) : null
        const bv = b[sortKey] != null ? parseFloat(b[sortKey] as string) : null
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return asc ? av - bv : bv - av
      })
    }

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      totalNetAssetValue,
    })
  } catch (err) {
    console.error("[managed-products/list]", err)
    return NextResponse.json({ error: "Failed to load managed products" }, { status: 500 })
  }
}
