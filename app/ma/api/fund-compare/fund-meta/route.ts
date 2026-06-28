import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface FundMetaRow {
  beian_hao: string
  product_name: string
  manager: string | null
  manager_scale: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  nav_start_date: string | null
  latest_nav_date: string | null
  unit_nav: string | null
  nav_frequency: string | null
  nav_source: string | null
  expected_ann_vol: string | null
  performance_fee_formula: string | null
  fund_alias: string | null
  remark: string | null
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const beian_haos = Array.isArray((body as { beian_haos?: unknown }).beian_haos)
    ? ((body as { beian_haos: unknown[] }).beian_haos as string[])
        .map((id) => String(id).trim())
        .filter(Boolean)
        .slice(0, 100)
    : []

  if (beian_haos.length === 0) {
    return NextResponse.json({ data: [] })
  }

  try {
    const rows = await query<{
      beian_hao: string
      product_name: string | null
      manager: string | null
      manager_scale: string | null
      strategy_l1: string | null
      strategy_l2: string | null
      inception_date: string | null
      nav_start_date: string | null
      latest_nav_date: string | null
      unit_nav: string | null
      fund_alias: string | null
      fee_pay: string | null
    }>(
      `SELECT
         i.beian_hao,
         i.product_name,
         i.manager,
         bt.scale AS manager_scale,
         COALESCE(
           NULLIF(BTRIM(ops.platform_strategy_one), ''),
           NULLIF(BTRIM(i.strategy_l1), '')
         ) AS strategy_l1,
         COALESCE(
           NULLIF(BTRIM(ops.platform_strategy_two), ''),
           NULLIF(BTRIM(ops.company_strategy_two), '')
         ) AS strategy_l2,
         i.inception_date::text AS inception_date,
         nav_start.nav_start_date::text AS nav_start_date,
         i.latest_nav_date::text AS latest_nav_date,
         i.latest_nav::text AS unit_nav,
         bt.fund_short_name AS fund_alias,
         bt.fee_pay
       FROM private_fund_info i
       LEFT JOIN type6_ops_team_full ops ON ops.register_number = i.beian_hao
       LEFT JOIN LATERAL (
         SELECT scale, fund_short_name, fee_pay
         FROM basicinfo_bfl_track
         WHERE register_number = i.beian_hao
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1
       ) bt ON true
       LEFT JOIN LATERAL (
         SELECT MIN(price_date)::text AS nav_start_date
         FROM private_fund_nav
         WHERE beian_hao = i.beian_hao
           AND nav IS NOT NULL AND nav > 0
       ) nav_start ON true
       WHERE i.beian_hao = ANY($1::text[])`,
      [beian_haos],
    )

    const byId = new Map(rows.map((row) => [row.beian_hao, row]))

    const data: FundMetaRow[] = beian_haos.map((beian_hao) => {
      const row = byId.get(beian_hao)
      if (!row) {
        return {
          beian_hao,
          product_name: beian_hao,
          manager: null,
          manager_scale: null,
          strategy_l1: null,
          strategy_l2: null,
          inception_date: null,
          nav_start_date: null,
          latest_nav_date: null,
          unit_nav: null,
          nav_frequency: null,
          nav_source: "平台净值",
          expected_ann_vol: null,
          performance_fee_formula: "未设置",
          fund_alias: null,
          remark: null,
        }
      }

      return {
        beian_hao: row.beian_hao,
        product_name: row.product_name ?? beian_hao,
        manager: row.manager,
        manager_scale: row.manager_scale,
        strategy_l1: row.strategy_l1,
        strategy_l2: row.strategy_l2,
        inception_date: row.inception_date?.slice(0, 10) ?? null,
        nav_start_date: row.nav_start_date?.slice(0, 10) ?? null,
        latest_nav_date: row.latest_nav_date?.slice(0, 10) ?? null,
        unit_nav: row.unit_nav,
        nav_frequency: inferNavFrequency(row.nav_start_date, row.latest_nav_date),
        nav_source: "平台净值",
        expected_ann_vol: null,
        performance_fee_formula: row.fee_pay?.trim() ? row.fee_pay : "未设置",
        fund_alias: row.fund_alias,
        remark: null,
      }
    })

    return NextResponse.json({ data })
  } catch (err) {
    console.error("[fund-compare/fund-meta]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}

function inferNavFrequency(navStart: string | null, latestNav: string | null): string | null {
  if (!navStart || !latestNav) return null
  const start = Date.parse(navStart)
  const end = Date.parse(latestNav)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const days = (end - start) / 86_400_000
  if (days <= 120) return "日频"
  return "周频"
}
