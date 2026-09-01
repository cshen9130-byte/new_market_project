import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { lookupAmacFundMetadata } from "@/lib/server/amac-fund-metadata"
import {
  BatchNavResolver,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"
import { ensureTrackingFundsListCacheTable } from "@/lib/server/tracking-funds-list-cache-pg"

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

function emptyMeta(beian_hao: string, product_name?: string): FundMetaRow {
  return {
    beian_hao,
    product_name: product_name || beian_hao,
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

function parseProducts(body: unknown): { beian_hao: string; product_name: string }[] {
  const raw = body as { beian_haos?: unknown; products?: unknown }
  const fromProducts = Array.isArray(raw.products)
    ? raw.products
        .map((item) => {
          const row = item as { beian_hao?: unknown; product_name?: unknown }
          const beian_hao = String(row.beian_hao ?? "").trim()
          if (!beian_hao) return null
          return {
            beian_hao,
            product_name: String(row.product_name ?? "").trim() || beian_hao,
          }
        })
        .filter((row): row is { beian_hao: string; product_name: string } => row != null)
        .slice(0, 100)
    : []
  if (fromProducts.length > 0) return fromProducts
  const beian_haos = Array.isArray(raw.beian_haos)
    ? raw.beian_haos.map((id) => String(id).trim()).filter(Boolean).slice(0, 100)
    : []
  return beian_haos.map((beian_hao) => ({ beian_hao, product_name: beian_hao }))
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const products = parseProducts(body)
  const beian_haos = products.map((p) => p.beian_hao)
  const requestedName = new Map(products.map((p) => [p.beian_hao, p.product_name]))

  if (beian_haos.length === 0) {
    return NextResponse.json({ data: [] })
  }

  try {
    await ensureTrackingFundsListCacheTable()

    const rows = await query<{
      beian_hao: string
      product_name: string | null
      short_name: string | null
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
         req.beian_hao,
         COALESCE(
           NULLIF(BTRIM(i.product_name), ''),
           NULLIF(BTRIM(bfl.product_name), ''),
           NULLIF(BTRIM(ops.fund_short_name), ''),
           NULLIF(BTRIM(ops.fund_name), ''),
           NULLIF(BTRIM(cache.product_name), ''),
           NULLIF(BTRIM(bt.fund_name), '')
         ) AS product_name,
         COALESCE(
           NULLIF(BTRIM(bfl.short_name), ''),
           NULLIF(BTRIM(cache.short_name), ''),
           NULLIF(BTRIM(ops.fund_short_name), '')
         ) AS short_name,
         COALESCE(
           NULLIF(BTRIM(i.manager), ''),
           NULLIF(BTRIM(bt.advisor), ''),
           NULLIF(BTRIM(bt.manager_names), '')
         ) AS manager,
         bt.scale AS manager_scale,
         COALESCE(
           NULLIF(BTRIM(ops.platform_strategy_one), ''),
           NULLIF(BTRIM(cache.platform_strategy_l1), ''),
           NULLIF(BTRIM(i.strategy_l1), ''),
           NULLIF(BTRIM(ops.company_strategy_one), ''),
           NULLIF(BTRIM(cache.company_strategy_l1), '')
         ) AS strategy_l1,
         COALESCE(
           NULLIF(BTRIM(ops.platform_strategy_two), ''),
           NULLIF(BTRIM(cache.platform_strategy_l2), ''),
           NULLIF(BTRIM(ops.company_strategy_two), ''),
           NULLIF(BTRIM(cache.company_strategy_l2), '')
         ) AS strategy_l2,
         COALESCE(i.inception_date::text, bt.inception_date::text) AS inception_date,
         nav_start.nav_start_date AS nav_start_date,
         COALESCE(
           i.latest_nav_date::text,
           cache.nav_date::text,
           t6nav.price_date,
           pfnav.price_date
         ) AS latest_nav_date,
         COALESCE(
           i.latest_nav::text,
           cache.unit_nav::text,
           t6nav.nav,
           pfnav.nav
         ) AS unit_nav,
         COALESCE(
           NULLIF(BTRIM(bt.fund_short_name), ''),
           NULLIF(BTRIM(bfl.short_name), '')
         ) AS fund_alias,
         bt.fee_pay
       FROM unnest($1::text[]) AS req(beian_hao)
       LEFT JOIN private_fund_info i ON i.beian_hao = req.beian_hao
       LEFT JOIN LATERAL (
         SELECT product_name, short_name
         FROM private_fund_info_bfl
         WHERE beian_hao = req.beian_hao
         LIMIT 1
       ) bfl ON true
       LEFT JOIN LATERAL (
         SELECT
           fund_name,
           fund_short_name,
           platform_strategy_one,
           platform_strategy_two,
           company_strategy_one,
           company_strategy_two
         FROM type6_ops_team_full
         WHERE register_number = req.beian_hao
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1
       ) ops ON true
       LEFT JOIN LATERAL (
         SELECT scale, fund_short_name, fund_name, fee_pay, advisor, manager_names, inception_date
         FROM basicinfo_bfl_track
         WHERE register_number = req.beian_hao OR record_key = req.beian_hao
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1
       ) bt ON true
       LEFT JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = req.beian_hao
       LEFT JOIN LATERAL (
         SELECT MIN(price_date)::text AS nav_start_date
         FROM (
           SELECT price_date FROM private_fund_nav
           WHERE beian_hao = req.beian_hao AND nav IS NOT NULL AND nav > 0
           UNION ALL
           SELECT price_date FROM private_fund_nav_group_type6
           WHERE beian_hao = req.beian_hao AND nav IS NOT NULL AND nav > 0
         ) dates
       ) nav_start ON true
       LEFT JOIN LATERAL (
         SELECT nav::text AS nav, price_date::text AS price_date
         FROM private_fund_nav_group_type6
         WHERE beian_hao = req.beian_hao AND nav IS NOT NULL AND nav > 0
         ORDER BY price_date DESC
         LIMIT 1
       ) t6nav ON true
       LEFT JOIN LATERAL (
         SELECT nav::text AS nav, price_date::text AS price_date
         FROM private_fund_nav
         WHERE beian_hao = req.beian_hao AND nav IS NOT NULL AND nav > 0
         ORDER BY price_date DESC
         LIMIT 1
       ) pfnav ON true`,
      [beian_haos],
    )

    const byId = new Map(rows.map((row) => [row.beian_hao, row]))

    const data: FundMetaRow[] = beian_haos.map((beian_hao) => {
      const row = byId.get(beian_hao)
      const fallbackName = requestedName.get(beian_hao) || beian_hao
      if (!row) return emptyMeta(beian_hao, fallbackName)

      return {
        beian_hao,
        product_name: row.product_name || fallbackName,
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

    const missingNav = data.filter((item) => !item.unit_nav || !item.nav_start_date)
    if (missingNav.length > 0) {
      const asOf = new Date().toISOString().slice(0, 10)
      const identities: ProductNavIdentity[] = missingNav.map((item) => {
        const row = byId.get(item.beian_hao)
        return {
          beian_hao: item.beian_hao,
          product_name: requestedName.get(item.beian_hao) || item.product_name,
          short_name: row?.short_name ?? null,
        }
      })
      const resolver = await BatchNavResolver.create(identities, asOf)
      for (let i = 0; i < missingNav.length; i++) {
        const item = missingNav[i]
        const identity = identities[i]
        if (!item.unit_nav) {
          const latest = resolver.resolveAt(identity, asOf)
          if (latest) {
            item.unit_nav = String(latest.nav)
            item.latest_nav_date = latest.nav_date
          }
        }
        if (!item.nav_start_date) {
          const history = resolver.mergedHistoryForRiskMetrics(identity, "1990-01-01")
          item.nav_start_date = history[0]?.nav_date ?? null
        }
        item.nav_frequency = inferNavFrequency(item.nav_start_date, item.latest_nav_date)
      }
    }

    const missingAmac = data.filter((item) => !item.manager_scale || !item.manager || !item.inception_date)
    if (missingAmac.length > 0) {
      const amacRows = await Promise.all(
        missingAmac.map(async (item) => {
          const amac = await lookupAmacFundMetadata(item.beian_hao, { managerHint: item.manager })
          return [item.beian_hao, amac] as const
        }),
      )
      const amacById = new Map(amacRows)
      for (const item of data) {
        const amac = amacById.get(item.beian_hao)
        if (!amac) continue
        if (!item.manager_scale) item.manager_scale = amac.mgmt_scale ?? null
        if (!item.manager) item.manager = amac.manager_name ?? null
        if (!item.inception_date) item.inception_date = amac.establish_date ?? null
      }
    }

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
