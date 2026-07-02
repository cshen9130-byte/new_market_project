import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { query } from "@/lib/db"
import { syncFundTeamTagsToSource } from "@/lib/server/sync-fund-team-tags"
import { invalidateListResponseCache } from "@/lib/server/list-response-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const POOL_TABLE: Record<string, string> = {
  tracking: "tracking_pool",
  selected: "selected_pool",
  core:     "core_pool",
  hy:       "hy_tracking_pool",
  fof:      "fof_mom_tracking",
}

function isCustomPool(pool: string) {
  return pool.startsWith("custom_") || pool.startsWith("mine_custom_") || pool === "mine_default"
}

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
  if (isCustomPool(pool)) {
    const rows = await query<{ product_name: string }>(
      `SELECT product_name FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2 LIMIT 1`,
      [pool, bh]
    )
    if (rows[0]?.product_name) return rows[0].product_name
  } else {
    const table = POOL_TABLE[pool]
    if (table) {
      const rows = await query<{ product_name: string }>(
        `SELECT product_name FROM ${table} WHERE register_number = $1 LIMIT 1`,
        [bh]
      )
      if (rows[0]?.product_name) return rows[0].product_name
    }
  }
  // Fallback: look up from the master fund table
  const fallback = await query<{ product_name: string }>(
    `SELECT product_name FROM type6_ops_team_full WHERE register_number = $1 LIMIT 1`,
    [bh]
  )
  return fallback[0]?.product_name ?? bh
}

async function addToPool(targetPool: string, bh: string, productName: string) {
  const rowHash = createHash("sha256").update(`${targetPool}::${bh}::${productName}`).digest("hex")
  if (isCustomPool(targetPool)) {
    await query(
      `INSERT INTO user_custom_pool
         (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
       SELECT $1,
              COALESCE((SELECT MAX(source_row_number) FROM user_custom_pool WHERE pool_key = $1), 0) + 1,
              $3, $2, $4, 'batch_op', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2)`,
      [targetPool, bh, productName, rowHash]
    )
  } else {
    const table = POOL_TABLE[targetPool] ?? "tracking_pool"
    await query(
      `WITH next_seq AS (SELECT COALESCE(MAX(source_row_number), 0) + 1 AS n FROM ${table})
       INSERT INTO ${table} (source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
       SELECT ns.n, $2, $1, $3, 'batch_op', NOW(), NOW() FROM next_seq ns
       WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE register_number = $1)`,
      [bh, productName, rowHash]
    )
  }
}

async function removeFromPool(pool: string, bh: string) {
  if (isCustomPool(pool)) {
    await query(`DELETE FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2`, [pool, bh])
  } else {
    const table = POOL_TABLE[pool]
    if (table) {
      await query(`DELETE FROM ${table} WHERE register_number = $1`, [bh])
    }
  }
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
        invalidateListResponseCache()
        return NextResponse.json({ ok: true, count: ids.length })
      }

      case "remove_tags": {
        await ensureFundTagsTable()
        const ph = ids.map((_, i) => `$${i + 1}`).join(", ")
        await query(`DELETE FROM ops_fund_tags WHERE beian_hao IN (${ph})`, ids)
        invalidateListResponseCache()
        return NextResponse.json({ ok: true, count: ids.length })
      }

      // ── Strategy ──────────────────────────────────────────────────────────
      case "set_strategy": {
        const ph = ids.map((_, i) => `$${i + 1}`).join(", ")
        await query(
          `UPDATE type6_ops_team_full
           SET company_strategy_one   = $${ids.length + 1},
               company_strategy_two   = $${ids.length + 2},
               company_strategy_three = $${ids.length + 3}
           WHERE register_number IN (${ph})`,
          [...ids, strategy_l1 ?? null, strategy_l2 ?? null, strategy_l3 ?? null]
        )
        invalidateListResponseCache()
        return NextResponse.json({ ok: true, count: ids.length })
      }

      case "remove_strategy": {
        const ph = ids.map((_, i) => `$${i + 1}`).join(", ")
        await query(
          `UPDATE type6_ops_team_full
           SET company_strategy_one   = NULL,
               company_strategy_two   = NULL,
               company_strategy_three = NULL
           WHERE register_number IN (${ph})`,
          ids
        )
        invalidateListResponseCache()
        return NextResponse.json({ ok: true, count: ids.length })
      }

      // ── Move / Copy ───────────────────────────────────────────────────────
      case "move":
      case "copy": {
        if (!target_pool) return NextResponse.json({ error: "missing_target_pool" }, { status: 400 })
        if (!pool) return NextResponse.json({ error: "missing_pool" }, { status: 400 })
        for (const bh of ids) {
          const productName = await getProductName(pool as string, bh)
          await addToPool(target_pool as string, bh, productName)
        }
        if (action === "move") {
          for (const bh of ids) {
            await removeFromPool(pool as string, bh)
          }
        }
        invalidateListResponseCache(pool as string)
        invalidateListResponseCache(target_pool as string)
        return NextResponse.json({ ok: true, count: ids.length })
      }

      // ── Remove from pool (批量取消跟踪) ────────────────────────────────────
      case "remove": {
        if (!pool) return NextResponse.json({ error: "missing_pool" }, { status: 400 })
        for (const bh of ids) {
          await removeFromPool(pool as string, bh)
        }
        invalidateListResponseCache(pool as string)
        return NextResponse.json({ ok: true, count: ids.length })
      }

      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 })
    }
  } catch (err) {
    console.error("[tracking-funds/batch]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
