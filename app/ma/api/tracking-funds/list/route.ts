import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name:    "i.product_name",
  latest_nav:      "COALESCE(ng.nav, ng_name.nav, ng_short.nav, nf.nav, nf_name.nav, nf_short.nav)::numeric",
  latest_nav_date: "COALESCE(ng.price_date, ng_name.price_date, ng_short.price_date, nf.price_date, nf_name.price_date, nf_short.price_date)",
  ret_1w:          "ret_1w",
  ret_1m:          "ret_1m",
  ret_3m:          "ret_3m",
  ret_6m:          "ret_6m",
  ret_1y:          "ret_1y",
}

function navScalarExpr(days: number): string {
  return `COALESCE(
    (SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
     WHERE ngc.beian_hao = i.beian_hao AND ngc.price_date <= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY ngc.price_date DESC LIMIT 1),
    (SELECT ngn.nav::numeric FROM private_fund_nav_group ngn
     WHERE ngn.product_name = i.product_name AND ngn.price_date <= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY ngn.price_date DESC LIMIT 1),
    (SELECT ngs.nav::numeric FROM private_fund_nav_group ngs
     WHERE i.short_name IS NOT NULL AND ngs.product_name = i.short_name AND ngs.price_date <= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY ngs.price_date DESC LIMIT 1),
    (SELECT nfc.nav::numeric FROM private_fund_nav nfc
     WHERE nfc.beian_hao = i.beian_hao AND nfc.price_date <= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY nfc.price_date DESC LIMIT 1),
    (SELECT nfn.nav::numeric FROM private_fund_nav nfn
     WHERE nfn.product_name = i.product_name AND nfn.price_date <= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY nfn.price_date DESC LIMIT 1),
    (SELECT nfs.nav::numeric FROM private_fund_nav nfs
     WHERE i.short_name IS NOT NULL AND nfs.product_name = i.short_name AND nfs.price_date <= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY nfs.price_date DESC LIMIT 1)
  )`
}

// Build a LATERAL subquery that gets the closest NAV on or before a given offset
function navAtOffset(alias: string, days: number): string {
  return `LEFT JOIN LATERAL (
    SELECT ${navScalarExpr(days)} AS nav
  ) ${alias} ON true`
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const isExport = searchParams.get("export") === "1"
  const pageSize = isExport ? 100000 : 50
  const offset   = isExport ? 0 : (page - 1) * pageSize
  const sortKey  = searchParams.get("sort") || "product_name"
  const sortDir  = searchParams.get("dir") === "desc" ? "DESC" : "ASC"
  const keyword    = (searchParams.get("keyword") || "").trim()
  const strategyL1 = (searchParams.get("strategy_l1") || "").trim()
  const strategyL2 = (searchParams.get("strategy_l2") || "").trim()
  const strategyL3 = (searchParams.get("strategy_l3") || "").trim()
  const orderCol = ALLOWED_SORT[sortKey] ?? "i.product_name"

  const filterParams: (string | number)[] = []
  const where: string[] = []

  if (strategyL1) {
    filterParams.push(strategyL1)
    where.push(`i.strategy_one = $${filterParams.length}`)
  }
  if (strategyL2) {
    filterParams.push(strategyL2)
    where.push(`i.strategy_two = $${filterParams.length}`)
  }
  if (strategyL3) {
    filterParams.push(`%${strategyL3}%`)
    where.push(`COALESCE(i.strategy_three, '') ILIKE $${filterParams.length}`)
  }
  if (keyword) {
    filterParams.push(`%${keyword}%`)
    where.push(`(i.product_name ILIKE $${filterParams.length} OR i.beian_hao ILIKE $${filterParams.length})`)
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const pLimit  = filterParams.length + 1
  const pOffset = filterParams.length + 2

  const orderSql = `${orderCol} ${sortDir} NULLS LAST`

  // Latest NAV (with group→regular fallback)
  const latestNavJoin = `
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group
      WHERE beian_hao = i.beian_hao
      ORDER BY price_date DESC LIMIT 1
    ) ng ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group
      WHERE product_name = i.product_name
      ORDER BY price_date DESC LIMIT 1
    ) ng_name ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group
      WHERE i.short_name IS NOT NULL AND product_name = i.short_name
      ORDER BY price_date DESC LIMIT 1
    ) ng_short ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav
      WHERE beian_hao = i.beian_hao
      ORDER BY price_date DESC LIMIT 1
    ) nf ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav
      WHERE product_name = i.product_name
      ORDER BY price_date DESC LIMIT 1
    ) nf_name ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav
      WHERE i.short_name IS NOT NULL AND product_name = i.short_name
      ORDER BY price_date DESC LIMIT 1
    ) nf_short ON true
  `

  const currentNavExpr = "COALESCE(ng.nav, ng_name.nav, ng_short.nav, nf.nav, nf_name.nav, nf_short.nav)"
  const currentDateExpr = "COALESCE(ng.price_date, ng_name.price_date, ng_short.price_date, nf.price_date, nf_name.price_date, nf_short.price_date)"
  const currentPctExpr = "COALESCE(ng.price_change, ng_name.price_change, ng_short.price_change, nf.price_change, nf_name.price_change, nf_short.price_change)"

  // Historical NAV at each window for period-return calculation
  const histJoins = [
    navAtOffset("h1w",  7),
    navAtOffset("h1m",  30),
    navAtOffset("h3m",  90),
    navAtOffset("h6m",  180),
    navAtOffset("h1y",  365),
  ].join("\n")

  try {
    const [rows, countRow] = await Promise.all([
      query<{
        beian_hao:           string
        product_name:        string
        short_name:          string | null
        strategy_l1:         string | null
        strategy_l2:         string | null
        manager:             string | null
        inception_date:      string | null
        latest_nav:          string | null
        latest_nav_date:     string | null
        latest_price_change: string | null
        ret_1w:              string | null
        ret_1m:              string | null
        ret_3m:              string | null
        ret_6m:              string | null
        ret_1y:              string | null
      }>(
        `SELECT
           i.beian_hao,
           i.product_name,
           i.short_name,
           i.strategy_one                                AS strategy_l1,
           i.strategy_two                                AS strategy_l2,
           NULL::text                                    AS manager,
           NULL::text                                    AS inception_date,
           ${currentNavExpr}::text                         AS latest_nav,
           ${currentDateExpr}::text                        AS latest_nav_date,
           ${currentPctExpr}::text                         AS latest_price_change,
           CASE WHEN h1w.nav IS NOT NULL AND h1w.nav <> 0
             THEN (((${currentNavExpr}) / h1w.nav) - 1)::text END AS ret_1w,
           CASE WHEN h1m.nav IS NOT NULL AND h1m.nav <> 0
             THEN (((${currentNavExpr}) / h1m.nav) - 1)::text END AS ret_1m,
           CASE WHEN h3m.nav IS NOT NULL AND h3m.nav <> 0
             THEN (((${currentNavExpr}) / h3m.nav) - 1)::text END AS ret_3m,
           CASE WHEN h6m.nav IS NOT NULL AND h6m.nav <> 0
             THEN (((${currentNavExpr}) / h6m.nav) - 1)::text END AS ret_6m,
           CASE WHEN h1y.nav IS NOT NULL AND h1y.nav <> 0
             THEN (((${currentNavExpr}) / h1y.nav) - 1)::text END AS ret_1y
         FROM private_fund_info_bfl i
         ${latestNavJoin}
         ${histJoins}
         ${whereClause}
         ORDER BY ${orderSql}
         LIMIT $${pLimit} OFFSET $${pOffset}`,
        [...filterParams, pageSize, offset]
      ),
      query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM private_fund_info_bfl i ${whereClause}`,
        filterParams
      ),
    ])

    const total = parseInt(countRow[0]?.total ?? "0")
    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: rows,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
