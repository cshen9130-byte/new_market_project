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
 * The built-in default pools are seeded into this table on first access so that
 * renaming, deleting and reordering them persists across page reloads — the DB,
 * not the hardcoded client list, is the source of truth.
 */

// Built-in team pools. The "全部" (all) pool is a client-only pseudo tab.
const DEFAULT_TEAM_POOLS: { pool_key: string; label: string }[] = [
  { pool_key: "bfl_ops", label: "bfl 运维池" },
  { pool_key: "bfl", label: "bfl跟踪池" },
  { pool_key: "jy_ops", label: "JY运维池" },
  { pool_key: "jy", label: "JY跟踪池" },
]

const CANONICAL_TEAM_KEYS = DEFAULT_TEAM_POOLS.map((p) => p.pool_key)

// Built-in "mine" pool. "mine_all" (全部) is a client-only pseudo tab.
const DEFAULT_MINE_POOL = { pool_key: "mine_default", label: "默认我的跟踪" }

// Bump when the canonical team pool set changes so existing DB rows resync once.
const TEAM_SEED_MARKER = "__team_defaults_v4_seeded__"
const LEGACY_TEAM_SEED_MARKER = "__team_defaults_seeded__"

let tableEnsured = false
let ensureInFlight: Promise<void> | null = null

async function ensureTable(): Promise<void> {
  if (tableEnsured) return
  if (ensureInFlight) return ensureInFlight
  ensureInFlight = _runEnsureTable().finally(() => { ensureInFlight = null })
  return ensureInFlight
}

async function _runEnsureTable(): Promise<void> {
  // Fast path: skip DDL when the table already exists (normal production case).
  const exists = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'tracking_custom_pools'
     LIMIT 1`,
  ).catch(() => [] as { ok: number }[])
  if (exists.length > 0) {
    tableEnsured = true
    return
  }

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
    await query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tracking_custom_pools TO market_user
    `).catch(() => {})
    await query(`
      GRANT USAGE, SELECT ON SEQUENCE tracking_custom_pools_id_seq TO market_user
    `).catch(() => {})
    tableEnsured = true
  } catch {
    await query(`SELECT 1 FROM tracking_custom_pools LIMIT 0`)
    tableEnsured = true
  }
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
}

let teamSeeded = false
const seededMineUsers = new Set<string>()

async function queryTeamPools(): Promise<PoolRow[]> {
  return query<PoolRow>(
    `SELECT pool_key, label, scope, user_key
     FROM tracking_custom_pools
     WHERE scope = 'team' AND pool_key NOT LIKE '\\_\\_%'
     ORDER BY sort_order ASC, id ASC`,
  )
}

async function queryMinePools(userKey: string): Promise<PoolRow[]> {
  return query<PoolRow>(
    `SELECT pool_key, label, scope, user_key
     FROM tracking_custom_pools
     WHERE scope = 'mine' AND user_key = $1 AND pool_key NOT LIKE '\\_\\_%'
     ORDER BY sort_order ASC, id ASC`,
    [userKey],
  )
}

/**
 * Seed / resync the canonical four team pools. Runs once per marker version so
 * legacy defaults (跟踪池 / 精选池 / …) and ad-hoc custom tabs are removed.
 */
async function seedTeamDefaults(): Promise<void> {
  if (teamSeeded) return
  const marker = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM tracking_custom_pools WHERE pool_key = $1 LIMIT 1`,
    [TEAM_SEED_MARKER],
  )
  if (marker.length > 0) { teamSeeded = true; return }

  // Preserve renamed labels when migrating legacy keys.
  await query(
    `UPDATE tracking_custom_pools SET pool_key = 'jy'
     WHERE pool_key = 'tracking' AND scope = 'team'`,
  )

  await query(
    `DELETE FROM tracking_custom_pools
     WHERE scope = 'team'
       AND pool_key NOT LIKE '\\_\\_%'
       AND pool_key NOT LIKE 'custom\\_%'
       AND NOT (pool_key = ANY($1::text[]))`,
    [CANONICAL_TEAM_KEYS],
  )

  for (let i = 0; i < DEFAULT_TEAM_POOLS.length; i++) {
    const p = DEFAULT_TEAM_POOLS[i]
    // Preserve user-renamed labels on conflict; only ensure row exists and sort_order.
    await query(
      `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
       VALUES ($1, $2, 'team', '', $3, NOW())
       ON CONFLICT (pool_key)
       DO UPDATE SET sort_order = EXCLUDED.sort_order, updated_at = NOW()`,
      [p.pool_key, p.label, i + 1],
    )
  }

  await query(`DELETE FROM tracking_custom_pools WHERE pool_key = $1`, [LEGACY_TEAM_SEED_MARKER])
  await query(
    `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
     VALUES ($1, '', 'team', '', -1, NOW())
     ON CONFLICT (pool_key) DO NOTHING`,
    [TEAM_SEED_MARKER],
  )
  teamSeeded = true
}

async function seedMineDefault(userKey: string): Promise<void> {
  if (seededMineUsers.has(userKey)) return
  await query(
    `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
     SELECT $1::text, $2::text, 'mine', $3::text, 0, NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM tracking_custom_pools
       WHERE pool_key = $1::text AND scope = 'mine' AND user_key = $3::text
     )`,
    [DEFAULT_MINE_POOL.pool_key, DEFAULT_MINE_POOL.label, userKey],
  )
  seededMineUsers.add(userKey)
}

function normalizeScope(raw: string | null | undefined): "team" | "mine" | "both" {
  if (raw === "mine") return "mine"
  if (raw === "both") return "both"
  return "team"
}

interface PoolRow {
  pool_key: string
  label: string
  scope: string
  user_key: string
}

const TEAM_POOLS_SQL = `
  SELECT pool_key, label, scope, user_key
  FROM tracking_custom_pools
  WHERE scope = 'team' AND pool_key NOT LIKE '\\_\\_%'
  ORDER BY sort_order ASC, id ASC`

const MINE_POOLS_SQL = `
  SELECT pool_key, label, scope, user_key
  FROM tracking_custom_pools
  WHERE scope = 'mine' AND user_key = $1 AND pool_key NOT LIKE '\\_\\_%'
  ORDER BY sort_order ASC, id ASC`

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const scopeRaw = searchParams.get("scope")
  const scope = normalizeScope(scopeRaw)
  const userKey = String(req.headers.get("x-market-user-id") || "").trim()

  try {
    await ensureTable()
    if (scope === "both") {
      await seedTeamDefaults()
      await seedMineDefault(userKey)
      const [team, mine] = await Promise.all([
        queryTeamPools(),
        queryMinePools(userKey),
      ])
      return NextResponse.json({ data: { team, mine } }, { headers: NO_STORE_HEADERS })
    }

    if (scope === "mine") {
      await seedMineDefault(userKey)
      const rows = await queryMinePools(userKey)
      return NextResponse.json({ data: rows }, { headers: NO_STORE_HEADERS })
    }

    await seedTeamDefaults()
    const rows = await queryTeamPools()
    return NextResponse.json({ data: rows }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[tracking-funds/pools GET]", msg)
    return NextResponse.json({ error: "db_error", detail: msg }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function POST(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }

  const { pool_key, label, scope: rawScope } = body as Record<string, string>
  const scope = rawScope === "mine" ? "mine" : "team"
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

function inferPoolScope(poolKey: string): "team" | "mine" {
  return poolKey.startsWith("mine_") ? "mine" : "team"
}

async function upsertPoolLabel(
  poolKey: string,
  cleanLabel: string,
  scope: "team" | "mine",
  userKey: string,
): Promise<PoolRow | null> {
  const rows = await query<PoolRow>(
    `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
     SELECT $1, $2, $3, $4,
            COALESCE((SELECT MAX(sort_order) FROM tracking_custom_pools WHERE scope = $3), 0) + 1,
            NOW()
     ON CONFLICT (pool_key)
     DO UPDATE SET label = EXCLUDED.label, updated_at = NOW()
     RETURNING pool_key, label, scope, user_key`,
    [poolKey, cleanLabel, scope, scope === "mine" ? userKey : ""],
  )
  return rows[0] ?? null
}

export async function PATCH(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE_HEADERS }) }

  const { pool_key, label } = body as Record<string, string>
  const cleanLabel = (label || "").trim()
  if (!pool_key || !cleanLabel) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const scope = inferPoolScope(pool_key)
  const userKey = String(req.headers.get("x-market-user-id") || "").trim()
  if (scope === "mine" && !userKey) {
    return NextResponse.json({ error: "missing_user" }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    await ensureTable()
    if (scope === "team") {
      await seedTeamDefaults()
    } else {
      await seedMineDefault(userKey)
    }
    const saved = await upsertPoolLabel(pool_key, cleanLabel, scope, userKey)
    if (!saved || saved.label !== cleanLabel) {
      return NextResponse.json({ error: "save_failed" }, { status: 500, headers: NO_STORE_HEADERS })
    }
    return NextResponse.json({ ok: true, pool: saved }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[tracking-funds/pools PATCH]", msg)
    return NextResponse.json({ error: "db_error", detail: msg }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

/** Persist drag-to-reorder: body { scope, keys: [...] } sets sort_order by index. */
export async function PUT(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }

  const { scope: rawScope, keys } = body as { scope?: string; keys?: unknown }
  const scope = rawScope === "mine" ? "mine" : "team"
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
