import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { createHash } from "crypto"
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

export async function POST(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }

  const { pool, beian_hao, product_name } = body as Record<string, string>
  if (!beian_hao || !product_name) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }

  try {
    if (isCustomPool(pool)) {
      // Custom / mine pools → user_custom_pool with pool_key discriminator
      const row_hash = createHash("sha256").update(`${pool}::${beian_hao}::${product_name}`).digest("hex")
      const rows = await query<{ id: number }>(
        `INSERT INTO user_custom_pool
           (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
         SELECT $1,
                COALESCE((SELECT MAX(source_row_number) FROM user_custom_pool WHERE pool_key = $1), 0) + 1,
                $3, $2, $4, 'manual_add', NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2
         )
         RETURNING id`,
        [pool, beian_hao, product_name, row_hash]
      )
      if (rows.length === 0) {
        return NextResponse.json({ error: "already_exists" }, { status: 409 })
      }
      invalidateListResponseCache(pool)
      return NextResponse.json({ ok: true, id: rows[0].id })
    }

    // Standard pool tables — use only the two columns present in all of them.
    const table = POOL_TABLE[pool] ?? "tracking_pool"
    const rows = await query<{ id: number }>(
      `INSERT INTO ${table} (product_name, register_number)
       SELECT $2, $1
       WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE register_number = $1)
       RETURNING id`,
      [beian_hao, product_name]
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: "already_exists" }, { status: 409 })
    }
    invalidateListResponseCache(pool)
    return NextResponse.json({ ok: true, id: rows[0].id })
  } catch (err) {
    console.error("[tracking-funds/add]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const pool = searchParams.get("pool") ?? ""
  const beian_hao = searchParams.get("beian_hao") ?? ""
  if (!pool || !beian_hao) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }
  try {
    if (isCustomPool(pool)) {
      await query(
        `DELETE FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2`,
        [pool, beian_hao]
      )
    } else {
      const table = POOL_TABLE[pool]
      if (!table) return NextResponse.json({ error: "unknown_pool" }, { status: 400 })
      await query(`DELETE FROM ${table} WHERE register_number = $1`, [beian_hao])
    }
    invalidateListResponseCache(pool)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[tracking-funds/add DELETE]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}

