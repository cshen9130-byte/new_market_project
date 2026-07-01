import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Persists user-created tracking pool definitions (the sidebar tabs/categories).
 *
 * Team pools (scope = 'team') are shared across every account so any user can see
 * lists added by a teammate. "Mine" pools (scope = 'mine') are scoped per user via
 * the x-market-user-id header.
 *
 * The built-in default pools (跟踪池 / 精选池 / …) are seeded into this table on
 * first access so that renaming, deleting and reordering them persists across page
 * reloads — the DB, not the hardcoded client list, is the source of truth.
 */

// Built-in team pools, seeded once. The "全部" (all) pool is a client-only pseudo
// tab and is intentionally not stored here.
const DEFAULT_TEAM_POOLS: { pool_key: string; label: string }[] = [
  { pool_key: "bfl_ops", label: "bfl 运维池" },
  { pool_key: "bfl", label: "bfl跟踪池" },
  { pool_key: "tracking", label: "跟踪池" },
  { pool_key: "selected", label: "精选池" },
  { pool_key: "core", label: "核心池" },
  { pool_key: "hy", label: "hy跟踪池" },
  { pool_key: "fof", label: "FOF&MOM跟踪" },
]

// Built-in "mine" pool. "mine_all" (全部) is a client-only pseudo tab.
const DEFAULT_MINE_POOL = { pool_key: "mine_default", label: "默认我的跟踪" }

// Marker row so team defaults are only ever seeded once — this lets a user delete
// a default pool for good without it reappearing on the next load.
const TEAM_SEED_MARKER = "__team_defaults_seeded__"

let ensured = false
async function ensureTable() {
  if (ensured) return
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS tracking_custom_pools (
        id         SERIAL PRIMARY KEY,
        pool_key   VARCHAR(128) NOT NULL UNIQUE,
        label      VARCHAR(255) NOT NULL,
        scope      VARCHAR(16)  NOT NULL DEFAULT 'team',
        user_key   VARCHAR(255) NOT NULL DEFAULT '',
        sort_order INTEGER      NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)
  } catch {
    // On PG 15+ the DB user may lack CREATE privilege on the public schema even
    // when the table already exists (created via schema.sql by a superuser).
    // Verify the table is reachable; if so, it's safe to proceed.
    await query(`SELECT 1 FROM tracking_custom_pools LIMIT 0`)
  }
  ensured = true
}

/**
 * Seed the built-in team pools exactly once. Uses a hidden marker row so that
 * deleting a default pool afterwards does not cause it to reappear.
 */
async function seedTeamDefaults(): Promise<void> {
  const marker = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM tracking_custom_pools WHERE pool_key = $1 LIMIT 1`,
    [TEAM_SEED_MARKER],
  )
  if (marker.length > 0) return

  for (let i = 0; i < DEFAULT_TEAM_POOLS.length; i++) {
    const p = DEFAULT_TEAM_POOLS[i]
    await query(
      `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
       VALUES ($1, $2, 'team', '', $3, NOW())
       ON CONFLICT (pool_key) DO NOTHING`,
      [p.pool_key, p.label, i + 1],
    )
  }
  await query(
    `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
     VALUES ($1, '', 'team', '', -1, NOW())
     ON CONFLICT (pool_key) DO NOTHING`,
    [TEAM_SEED_MARKER],
  )
}

/**
 * Ensure the current user has the built-in "默认我的跟踪" pool. It can be renamed
 * but not deleted, so seeding it when missing is always safe.
 */
async function seedMineDefault(userKey: string): Promise<void> {
  await query(
    `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
     SELECT $1, $2, 'mine', $3, 0, NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM tracking_custom_pools
       WHERE pool_key = $1 AND scope = 'mine' AND user_key = $3
     )`,
    [DEFAULT_MINE_POOL.pool_key, DEFAULT_MINE_POOL.label, userKey],
  )
}

function normalizeScope(raw: string | null | undefined): "team" | "mine" {
  return raw === "mine" ? "mine" : "team"
}

interface PoolRow {
  pool_key: string
  label: string
  scope: string
  user_key: string
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const scope = normalizeScope(searchParams.get("scope"))
  const userKey = String(req.headers.get("x-market-user-id") || "").trim()

  try {
    await ensureTable()
    let rows: PoolRow[]
    if (scope === "mine") {
      await seedMineDefault(userKey)
      rows = await query<PoolRow>(
        `SELECT pool_key, label, scope, user_key
         FROM tracking_custom_pools
         WHERE scope = 'mine' AND user_key = $1 AND pool_key NOT LIKE '\\_\\_%'
         ORDER BY sort_order ASC, id ASC`,
        [userKey],
      )
    } else {
      await seedTeamDefaults()
      rows = await query<PoolRow>(
        `SELECT pool_key, label, scope, user_key
         FROM tracking_custom_pools
         WHERE scope = 'team' AND pool_key NOT LIKE '\\_\\_%'
         ORDER BY sort_order ASC, id ASC`,
      )
    }
    return NextResponse.json({ data: rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[tracking-funds/pools GET]", msg)
    return NextResponse.json({ error: "db_error", detail: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }

  const { pool_key, label, scope: rawScope } = body as Record<string, string>
  const scope = normalizeScope(rawScope)
  const userKey = String(req.headers.get("x-market-user-id") || "").trim()
  const cleanLabel = (label || "").trim()
  if (!pool_key || !cleanLabel) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }

  try {
    await ensureTable()
    await query(
      `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
       SELECT $1, $2, $3, $4,
              COALESCE((SELECT MAX(sort_order) FROM tracking_custom_pools WHERE scope = $5), 0) + 1,
              NOW()
       ON CONFLICT (pool_key)
       DO UPDATE SET label = EXCLUDED.label, updated_at = NOW()`,
      [pool_key, cleanLabel, scope, scope === "mine" ? userKey : "", scope],
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[tracking-funds/pools POST]", msg)
    return NextResponse.json({ error: "db_error", detail: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }

  const { pool_key, label } = body as Record<string, string>
  const cleanLabel = (label || "").trim()
  if (!pool_key || !cleanLabel) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }

  try {
    await ensureTable()
    await query(
      `UPDATE tracking_custom_pools SET label = $2, updated_at = NOW() WHERE pool_key = $1`,
      [pool_key, cleanLabel],
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[tracking-funds/pools PATCH]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}

/** Persist drag-to-reorder: body { scope, keys: [...] } sets sort_order by index. */
export async function PUT(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }

  const { scope: rawScope, keys } = body as { scope?: string; keys?: unknown }
  const scope = normalizeScope(rawScope)
  const userKey = String(req.headers.get("x-market-user-id") || "").trim()
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }
  const orderedKeys = keys as string[]

  try {
    await ensureTable()
    for (let i = 0; i < orderedKeys.length; i++) {
      const poolKey = orderedKeys[i].trim()
      if (!poolKey) continue
      if (scope === "mine") {
        await query(
          `UPDATE tracking_custom_pools SET sort_order = $2, updated_at = NOW()
           WHERE pool_key = $1 AND scope = 'mine' AND user_key = $3`,
          [poolKey, i + 1, userKey],
        )
      } else {
        await query(
          `UPDATE tracking_custom_pools SET sort_order = $2, updated_at = NOW()
           WHERE pool_key = $1 AND scope = 'team'`,
          [poolKey, i + 1],
        )
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[tracking-funds/pools PUT]", msg)
    return NextResponse.json({ error: "db_error", detail: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const poolKey = (searchParams.get("pool_key") || "").trim()
  if (!poolKey) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }

  try {
    await ensureTable()
    await query(`DELETE FROM tracking_custom_pools WHERE pool_key = $1`, [poolKey])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[tracking-funds/pools DELETE]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
