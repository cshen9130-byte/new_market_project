import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "product_name",
  latest_nav: "latest_unit_nav",
  latest_nav_date: "latest_nav_date",
  latest_price_change: "latest_return_pct",
  market_value: "market_value",
  ret_1w: "ret_1w",
  ret_1m: "ret_1m",
  ret_3m: "ret_3m",
  ret_6m: "ret_6m",
  ret_1y: "ret_1y",
  sharpe_1y: "sharpe_1y",
  calmar_1y: "calmar_1y",
}

const BEIAN_EXPR = "COALESCE(b.beian_hao, o.register_number)"
const PRODUCT_EXPR = "f.product_name"
const SHORT_EXPR = "COALESCE(b.short_name, o.fund_short_name)"

function fofNavScalarExpr(days: number, cutoffExpr: string): string {
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
    SELECT ${fofNavScalarExpr(days, cutoffExpr)} AS nav
  ) ${alias} ON true`
}

interface FofOverviewRow {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  market_value: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y?: string | null
  sharpe_1y?: string | null
  calmar_1y?: string | null
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
    const holdingStatus = searchParams.get("holding_status") || "holding"
    const teamTagMode = searchParams.get("team_tag_mode") === "or" ? "or" : "and"
    const teamTags = searchParams.getAll("team_tag").map((t) => t.trim()).filter(Boolean)
    const fofRegister = (searchParams.get("fof_register_number") || "").trim()
    const sortParam = searchParams.get("sort") || ""
    const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "sequence_no"
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const sortCol = sortKey === "sequence_no" ? "sequence_no" : ALLOWED_SORT[sortKey]
    const cutoffRaw = (searchParams.get("cutoff") || "").trim()
    const hasCutoff = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)

    const strategyCol = strategySource === "platform" ? "o.platform_strategy_one" : "o.company_strategy_one"
    const strategyExpr = `COALESCE(NULLIF(BTRIM(${strategyCol}), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`
    const teamTagsExpr = `CASE WHEN jsonb_typeof(o.tag->'company') = 'array' THEN o.tag->'company' ELSE '[]'::jsonb END`

    const conditions: string[] = ["f.product_name <> '合计'"]
    const params: unknown[] = []
    let pi = 1

    if (keyword) {
      conditions.push(`(
        f.product_name ILIKE $${pi}
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

    if (holdingStatus === "holding") {
      conditions.push(`COALESCE(f.market_value, 0) > 0`)
    } else if (holdingStatus === "cleared") {
      conditions.push(`COALESCE(f.market_value, 0) <= 0`)
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

    if (fofRegister) {
      conditions.push(`f.fof_fund_name = (SELECT product_name FROM fof_mom_tracking WHERE register_number = $${pi} LIMIT 1)`)
      params.push(fofRegister)
      pi++
    }

    const where = conditions.join(" AND ")

    const baseFrom = `
      FROM fof_underlying_summary f
      LEFT JOIN LATERAL (
        SELECT beian_hao, short_name, strategy_company
        FROM private_fund_info_bfl
        WHERE product_name = f.product_name OR short_name = f.product_name
        LIMIT 1
      ) b ON true
      LEFT JOIN LATERAL (
        SELECT register_number, fund_short_name, company_strategy_one, platform_strategy_one, tag
        FROM type6_ops_team_full
        WHERE fund_name = f.product_name OR fund_short_name = f.product_name
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1
      ) o ON true
      LEFT JOIN private_fund_info pinfo ON pinfo.beian_hao = ${BEIAN_EXPR}
    `

    const [countRows, totalMvRows] = await Promise.all([
      query<{ n: string }>(`SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`, params),
      query<{ total_mv: string }>(
        `SELECT COALESCE(SUM(f.market_value), 0)::text AS total_mv ${baseFrom} WHERE ${where}`,
        params,
      ),
    ])
    const total = parseInt(countRows[0]?.n || "0", 10)
    const totalMarketValue = totalMvRows[0]?.total_mv ?? "0"

    const listParams = [...params]
    let cutoffExpr = "CURRENT_DATE"
    if (hasCutoff) {
      listParams.push(cutoffRaw)
      cutoffExpr = `$${listParams.length}::date`
    }
    const currentNavExpr = "f.latest_unit_nav::numeric"
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
      market_value: string | null
      sequence_no: number | null
      ret_1w: string | null
      ret_1m: string | null
      ret_3m: string | null
      ret_6m: string | null
      ret_1y: string | null
      sharpe_1y: string | null
      calmar_1y: string | null
    }>(
      `SELECT * FROM (
         SELECT
           f.id::text AS id,
           f.sequence_no,
           ${BEIAN_EXPR} AS beian_hao,
           f.product_name,
           COALESCE(b.short_name, o.fund_short_name, f.product_name) AS short_name,
           ${strategyExpr} AS strategy_l1,
           f.latest_unit_nav::text AS latest_unit_nav,
           f.latest_nav_date,
           f.latest_return_pct::text AS latest_return_pct,
           f.market_value::text AS market_value,
           CASE WHEN h1w.nav IS NOT NULL AND h1w.nav <> 0
             THEN ((${currentNavExpr}) / h1w.nav - 1)::text END AS ret_1w,
           CASE WHEN h1m.nav IS NOT NULL AND h1m.nav <> 0
             THEN ((${currentNavExpr}) / h1m.nav - 1)::text END AS ret_1m,
           CASE WHEN h3m.nav IS NOT NULL AND h3m.nav <> 0
             THEN ((${currentNavExpr}) / h3m.nav - 1)::text END AS ret_3m,
           CASE WHEN h6m.nav IS NOT NULL AND h6m.nav <> 0
             THEN ((${currentNavExpr}) / h6m.nav - 1)::text END AS ret_6m,
           CASE WHEN h1y.nav IS NOT NULL AND h1y.nav <> 0
             THEN ((${currentNavExpr}) / h1y.nav - 1)::text END AS ret_1y,
           pinfo.sharpe_1y::text AS sharpe_1y,
           pinfo.calmar_1y::text AS calmar_1y
         ${baseFrom}
         ${histJoins}
         WHERE ${where}
       ) rows
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, sequence_no ASC
       LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
      [...listParams, pageSize, offset],
    )

    const data: FofOverviewRow[] = rows.map((r) => ({
      id: r.id,
      beian_hao: r.beian_hao,
      product_name: r.product_name,
      short_name: r.short_name,
      strategy_l1: r.strategy_l1,
      latest_nav: r.latest_unit_nav,
      latest_nav_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
      latest_price_change: r.latest_return_pct != null ? String(parseFloat(r.latest_return_pct) / 100) : null,
      market_value: r.market_value,
      ret_1w: r.ret_1w,
      ret_1m: r.ret_1m,
      ret_3m: r.ret_3m,
      ret_6m: r.ret_6m,
      ret_1y: r.ret_1y,
      sharpe_1y: r.sharpe_1y,
      calmar_1y: r.calmar_1y,
    }))

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      totalMarketValue,
    })
  } catch (err) {
    console.error("[investment/fof-overview/list]", err)
    return NextResponse.json({ error: "Failed to load FOF overview data" }, { status: 500 })
  }
}
