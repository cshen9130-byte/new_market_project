import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Ensure the fund-tags table exists
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_tags (
      id          SERIAL PRIMARY KEY,
      beian_hao   VARCHAR(64) NOT NULL,
      tag_name    VARCHAR(255) NOT NULL,
      created_by  VARCHAR(255) NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, tag_name)
    )
  `)
}

interface FundTagRow {
  id: number
  beian_hao: string
  tag_name: string
  created_by: string
  created_at: string
}

interface PoolRow {
  pool_key: string
  pool_label: string
}

const POOL_LABELS: Record<string, string> = {
  bfl_ops:  "bfl 运维池",
  bfl:      "bfl跟踪池",
  tracking: "跟踪池",
  selected: "精选池",
  core:     "核心池",
  hy:       "hy跟踪池",
  fof:      "FOF&MOM跟踪",
  all:      "全部",
}

export async function GET(req: Request) {
  try {
    await ensureTable()
    const { searchParams } = new URL(req.url)
    const beian_hao = searchParams.get("beian_hao")
    if (!beian_hao) return NextResponse.json({ tags: [], pools: [] })

    // Get tags
    const tags = await query<FundTagRow>(
      `SELECT id, beian_hao, tag_name, created_by, created_at
       FROM ops_fund_tags
       WHERE beian_hao = $1
       ORDER BY created_at`,
      [beian_hao]
    )

    // Get pool memberships from standard pools
    const poolResults: { pool_key: string; pool_label: string }[] = []

    // Check standard pools
    const standardPools = [
      { key: "bfl_ops",  table: "type6_ops_team_full",    col: "register_number" },
      { key: "bfl",     table: "private_fund_info_bfl",  col: "beian_hao" },
      { key: "tracking", table: "tracking_pool",         col: "register_number" },
      { key: "selected", table: "selected_pool",         col: "register_number" },
      { key: "core",     table: "core_pool",             col: "register_number" },
      { key: "hy",       table: "hy_tracking_pool",      col: "register_number" },
      { key: "fof",      table: "fof_mom_tracking",      col: "register_number" },
    ]
    for (const p of standardPools) {
      try {
        const rows = await query(
          `SELECT 1 FROM ${p.table} WHERE ${p.col} = $1 LIMIT 1`,
          [beian_hao]
        )
        if (rows.length > 0) {
          poolResults.push({ pool_key: p.key, pool_label: POOL_LABELS[p.key] ?? p.key })
        }
      } catch { /* table may not exist */ }
    }

    // Check custom pools
    try {
      const customRows = await query<{ pool_key: string }>(
        `SELECT pool_key FROM user_custom_pool WHERE register_number = $1`,
        [beian_hao]
      )
      for (const row of customRows) {
        const label = row.pool_key.replace(/^(custom_|mine_custom_)/, "").replace(/_/g, " ") || row.pool_key
        poolResults.push({ pool_key: row.pool_key, pool_label: label + "池" })
      }
    } catch { /* table may not exist */ }

    return NextResponse.json({ tags: tags.map((t) => t.tag_name), pools: poolResults })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await ensureTable()
    const body = await req.json()
    const { beian_hao, tag_name, user_name = "" } = body as Record<string, string>
    if (!beian_hao || !tag_name?.trim()) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 })
    }
    await query(
      `INSERT INTO ops_fund_tags (beian_hao, tag_name, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (beian_hao, tag_name) DO NOTHING`,
      [beian_hao, tag_name.trim(), user_name]
    )
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    await ensureTable()
    const { searchParams } = new URL(req.url)
    const beian_hao = searchParams.get("beian_hao")
    const tag_name = searchParams.get("tag_name")
    if (!beian_hao || !tag_name) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 })
    }
    await query(
      `DELETE FROM ops_fund_tags WHERE beian_hao = $1 AND tag_name = $2`,
      [beian_hao, tag_name]
    )
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
