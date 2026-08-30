import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { syncCompanyStrategyCaches } from "@/lib/server/company-strategy-sync"
import { syncFundTeamTagsToSource } from "@/lib/server/sync-fund-team-tags"
import { upsertTrackingFundListCacheEntry } from "@/lib/server/tracking-funds-list-cache-pg"
import { isCodeLikeProductName, resolveTrackingProductName } from "@/lib/server/tracking-product-name"
import {
  addFundToTrackingPool,
  invalidateTrackingPoolListCaches,
  isCustomTrackingPool,
  isWritableTrackingPool,
  REGISTER_POOL_TABLE,
  removeFundFromTrackingPool,
} from "@/lib/server/tracking-pool-membership"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const POOL_TABLE = REGISTER_POOL_TABLE

async function ensureFundTagsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_tags (
      id         SERIAL PRIMARY KEY,
      beian_hao  VARCHAR(64) NOT NULL,
      tag_name   VARCHAR(255) NOT NULL,
      created_by VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, tag_name)
    )
  `)
}

async function getProductName(pool: string, bh: string): Promise<string> {
  let stored: string | undefined
  if (isCustomTrackingPool(pool)) {
    const rows = await query<{ product_name: string }>(
      `SELECT product_name FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2 LIMIT 1`,
      [pool, bh]
    )
    stored = rows[0]?.product_name
  } else if (pool === "bfl") {
    const rows = await query<{ product_name: string }>(
      `SELECT product_name FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
      [bh]
    )
    stored = rows[0]?.product_name
  } else {
    const table = POOL_TABLE[pool]
    if (table) {
      const rows = await query<{ product_name: string }>(
        `SELECT product_name FROM ${table} WHERE register_number = $1 LIMIT 1`,
        [bh]
      )
      stored = rows[0]?.product_name
    }
  }
  if (stored && !isCodeLikeProductName(stored, bh)) return stored
  return resolveTrackingProductName(bh, stored || bh)
}

export async function POST(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }

  const {
    action,
    beian_haos,
    pool,
    target_pool,
    tags,
    strategy_l1,
    strategy_l2,
    strategy_l3,
  } = body as Record<string, unknown>

  if (!action || !Array.isArray(beian_haos) || beian_haos.length === 0) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }

  const ids = beian_haos as string[]

  try {
    switch (action) {
      // ── Tags ──────────────────────────────────────────────────────────────
      case "add_tags": {
        if (!Array.isArray(tags) || (tags as string[]).length === 0) {
          return NextResponse.json({ error: "no_tags" }, { status: 400 })
        }
        await ensureFundTagsTable()
        for (const bh of ids) {
          for (const tag of tags as string[]) {
            await query(
              `INSERT INTO ops_fund_tags (beian_hao, tag_name)
               VALUES ($1, $2)
               ON CONFLICT (beian_hao, tag_name) DO NOTHING`,
              [bh, (tag as string).trim()]
            )
          }
          await syncFundTeamTagsToSource(bh)
        }
        invalidateTrackingPoolListCaches([])
        return NextResponse.json({ ok: true, count: ids.length })
      }

      case "remove_tags": {
        await ensureFundTagsTable()
        const ph = ids.map((_, i) => `$${i + 1}`).join(", ")
        await query(`DELETE FROM ops_fund_tags WHERE beian_hao IN (${ph})`, ids)
        invalidateTrackingPoolListCaches([])
        return NextResponse.json({ ok: true, count: ids.length })
      }

      // ── Strategy ──────────────────────────────────────────────────────────
      case "set_strategy": {
        const ph = ids.map((_, i) => `$${i + 1}`).join(", ")
        const l1 = strategy_l1 ?? null
        const l2 = strategy_l2 ?? null
        const l3 = strategy_l3 ?? null
        await query(
          `UPDATE type6_ops_team_full
           SET company_strategy_one   = $${ids.length + 1},
               company_strategy_two   = $${ids.length + 2},
               company_strategy_three = $${ids.length + 3},
               updated_at = NOW()
           WHERE register_number IN (${ph})`,
          [...ids, l1, l2, l3]
        )
        await syncCompanyStrategyCaches(
          ids.map((beian_hao) => ({
            beian_hao,
            strategy_l1: l1,
            strategy_l2: l2,
            strategy_l3: l3,
          })),
        )
        return NextResponse.json({ ok: true, count: ids.length })
      }

      case "remove_strategy": {
        const ph = ids.map((_, i) => `$${i + 1}`).join(", ")
        await query(
          `UPDATE type6_ops_team_full
           SET company_strategy_one   = NULL,
               company_strategy_two   = NULL,
               company_strategy_three = NULL,
               updated_at = NOW()
           WHERE register_number IN (${ph})`,
          ids
        )
        await syncCompanyStrategyCaches(
          ids.map((beian_hao) => ({
            beian_hao,
            strategy_l1: null,
            strategy_l2: null,
            strategy_l3: null,
          })),
        )
        return NextResponse.json({ ok: true, count: ids.length })
      }

      // ── Move / Copy ───────────────────────────────────────────────────────
      case "move":
      case "copy": {
        if (!target_pool) return NextResponse.json({ error: "missing_target_pool" }, { status: 400 })
        if (!pool) return NextResponse.json({ error: "missing_pool" }, { status: 400 })
        const tp = target_pool as string
        if (!isWritableTrackingPool(tp)) {
          return NextResponse.json(
            { error: `"${tp}" 不是可写入的产品池，请选择跟踪池、精选池、核心池等` },
            { status: 400 }
          )
        }
        for (const bh of ids) {
          const productName = await getProductName(pool as string, bh)
          await addFundToTrackingPool(tp, bh, productName)
          try {
            await upsertTrackingFundListCacheEntry(bh, productName)
          } catch (err) {
            console.error("[tracking-funds/batch] cache upsert failed", bh, err)
          }
        }
        if (action === "move") {
          for (const bh of ids) {
            await removeFundFromTrackingPool(pool as string, bh)
          }
        }
        invalidateTrackingPoolListCaches([pool as string, tp])
        return NextResponse.json({ ok: true, count: ids.length })
      }

      // ── Remove from pool (批量取消跟踪) ────────────────────────────────────
      case "remove": {
        if (!pool) return NextResponse.json({ error: "missing_pool" }, { status: 400 })
        for (const bh of ids) {
          await removeFundFromTrackingPool(pool as string, bh)
        }
        invalidateTrackingPoolListCaches([pool as string])
        return NextResponse.json({ ok: true, count: ids.length })
      }

      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 })
    }
  } catch (err) {
    console.error("[tracking-funds/batch]", err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
