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
 */

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
    const rows =
      scope === "mine"
        ? await query<PoolRow>(
            `SELECT pool_key, label, scope, user_key
             FROM tracking_custom_pools
             WHERE scope = 'mine' AND user_key = $1
             ORDER BY sort_order ASC, id ASC`,
            [userKey],
          )
        : await query<PoolRow>(
            `SELECT pool_key, label, scope, user_key
             FROM tracking_custom_pools
             WHERE scope = 'team'
             ORDER BY sort_order ASC, id ASC`,
          )
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
