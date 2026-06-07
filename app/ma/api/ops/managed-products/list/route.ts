import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "m.product_name",
  latest_nav: "m.latest_unit_nav",
  latest_nav_date: "m.latest_nav_date",
  latest_price_change: "m.latest_return_pct",
  custody_balance: "m.custody_account_balance",
  net_asset_value: "m.net_asset_value",
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
    const sortCol = sortKey === "sequence_no" ? "m.sequence_no" : ALLOWED_SORT[sortKey]

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

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`,
      params,
    )
    const total = parseInt(countRows[0]?.n || "0", 10)

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
    }>(
      `SELECT
         m.id::text AS id,
         COALESCE(b.beian_hao, o.register_number) AS beian_hao,
         m.product_name,
         COALESCE(b.short_name, o.fund_short_name, m.product_name) AS short_name,
         ${strategyExpr} AS strategy_l1,
         m.latest_unit_nav::text AS latest_unit_nav,
         m.latest_nav_date,
         m.latest_return_pct::text AS latest_return_pct,
         m.custody_account_balance::text AS custody_account_balance,
         m.net_asset_value::text AS net_asset_value
       ${baseFrom}
       WHERE ${where}
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, m.sequence_no ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, pageSize, offset],
    )

    const data: ManagedRow[] = rows.map((r) => ({
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
    }))

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    console.error("[managed-products/list]", err)
    return NextResponse.json({ error: "Failed to load managed products" }, { status: 500 })
  }
}
