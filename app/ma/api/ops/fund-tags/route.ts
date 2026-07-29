import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  isKnownCustomPoolKey,
  purgeOrphanedCustomPoolMemberships,
} from "@/lib/server/tracking-pool-membership"

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

const POOL_LABELS: Record<string, string> = {
  bfl_ops:  "bfl 运维池",
  bfl:      "bfl跟踪池",
  jy_ops:   "JY运维池",
  jy:       "JY跟踪池",
  tracking: "JY跟踪池",
  selected: "精选池",
  core:     "核心池",
  hy:       "hy跟踪池",
  fof:      "FOF&MOM跟踪",
  all:      "全部",
  mine_default: "默认我的跟踪",
}

function formatPoolLabel(poolKey: string, savedLabel: string | null | undefined): string {
  const trimmed = savedLabel?.trim()
  if (trimmed) return trimmed
  if (POOL_LABELS[poolKey]) return POOL_LABELS[poolKey]
  const stripped = poolKey.replace(/^(custom_|mine_custom_)/, "").replace(/_/g, " ").trim()
  if (!stripped || /^\d+$/.test(stripped)) return poolKey
  return stripped.endsWith("池") ? stripped : `${stripped}池`
}

const STANDARD_POOLS = [
  { key: "bfl_ops",  table: "type6_ops_team_full",    col: "register_number" },
  { key: "bfl",     table: "private_fund_info_bfl",  col: "beian_hao" },
  { key: "jy",      table: "tracking_pool",          col: "register_number" },
  { key: "selected", table: "selected_pool",         col: "register_number" },
  { key: "core",     table: "core_pool",             col: "register_number" },
  { key: "hy",       table: "hy_tracking_pool",      col: "register_number" },
  { key: "fof",      table: "fof_mom_tracking",      col: "register_number" },
] as const

/** Avoid running orphan purge on every cell/N+1 request — once per minute max. */
let lastPurgeAt = 0
async function maybePurgeOrphans(): Promise<void> {
  const now = Date.now()
  if (now - lastPurgeAt < 60_000) return
  lastPurgeAt = now
  await purgeOrphanedCustomPoolMemberships()
}

function parseBeianList(searchParams: URLSearchParams): string[] {
  const multi = searchParams.getAll("beian_hao").map((s) => s.trim()).filter(Boolean)
  const csv = (searchParams.get("beian_haos") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const b of [...multi, ...csv]) {
    if (seen.has(b)) continue
    seen.add(b)
    out.push(b)
  }
  return out
}

async function loadPoolMembershipsByBeian(
  beians: string[],
): Promise<Map<string, { pool_key: string; pool_label: string }[]>> {
  const byBeian = new Map<string, { pool_key: string; pool_label: string }[]>()
  for (const b of beians) byBeian.set(b, [])

  let labelByKey = new Map(Object.entries(POOL_LABELS))
  try {
    const labelRows = await query<{ pool_key: string; label: string }>(
      `SELECT pool_key, label FROM tracking_custom_pools
       WHERE pool_key NOT LIKE '\\_\\_%'`,
    )
    for (const row of labelRows) labelByKey.set(row.pool_key, row.label)
  } catch { /* table may not exist */ }
  const definedPoolKeys = new Set(labelByKey.keys())

  for (const p of STANDARD_POOLS) {
    try {
      const rows = await query<Record<string, string>>(
        `SELECT DISTINCT ${p.col} AS beian
         FROM ${p.table}
         WHERE ${p.col} = ANY($1::text[])`,
        [beians],
      )
      const label = labelByKey.get(p.key) ?? POOL_LABELS[p.key] ?? p.key
      for (const row of rows) {
        const beian = String(row.beian ?? "").trim()
        if (!beian) continue
        const list = byBeian.get(beian)
        if (!list) continue
        if (list.some((x) => x.pool_key === p.key)) continue
        list.push({ pool_key: p.key, pool_label: label })
      }
    } catch { /* table may not exist */ }
  }

  try {
    const customRows = await query<{ register_number: string; pool_key: string; label: string | null }>(
      `SELECT u.register_number, u.pool_key, COALESCE(p.label, '') AS label
       FROM user_custom_pool u
       LEFT JOIN tracking_custom_pools p ON p.pool_key = u.pool_key
       WHERE u.register_number = ANY($1::text[])`,
      [beians],
    )
    for (const row of customRows) {
      const beian = String(row.register_number ?? "").trim()
      if (!beian) continue
      if (!isKnownCustomPoolKey(row.pool_key, definedPoolKeys)) continue
      const list = byBeian.get(beian)
      if (!list) continue
      if (list.some((x) => x.pool_key === row.pool_key)) continue
      list.push({
        pool_key: row.pool_key,
        pool_label: formatPoolLabel(row.pool_key, row.label || labelByKey.get(row.pool_key)),
      })
    }
  } catch { /* table may not exist */ }

  return byBeian
}

export async function GET(req: Request) {
  try {
    await ensureTable()
    await maybePurgeOrphans()
    const { searchParams } = new URL(req.url)
    const beians = parseBeianList(searchParams)

    // Empty / missing → keep old single-beian contract shape
    if (beians.length === 0) return NextResponse.json({ tags: [], pools: [] })

    const tags = await query<FundTagRow>(
      `SELECT id, beian_hao, tag_name, created_by, created_at
       FROM ops_fund_tags
       WHERE beian_hao = ANY($1::text[])
       ORDER BY created_at`,
      [beians],
    )
    const tagsByBeian = new Map<string, string[]>()
    for (const b of beians) tagsByBeian.set(b, [])
    for (const t of tags) {
      const list = tagsByBeian.get(t.beian_hao)
      if (list) list.push(t.tag_name)
    }

    const poolsByBeian = await loadPoolMembershipsByBeian(beians)

    // Batch response for 尽调表格 / multi-row callers
    if (beians.length > 1 || searchParams.has("beian_haos") || searchParams.getAll("beian_hao").length > 1) {
      const byBeian: Record<string, { tags: string[]; pools: { pool_key: string; pool_label: string }[] }> = {}
      for (const b of beians) {
        byBeian[b] = {
          tags: tagsByBeian.get(b) ?? [],
          pools: poolsByBeian.get(b) ?? [],
        }
      }
      return NextResponse.json({ byBeian })
    }

    // Single-beian legacy shape
    const beian = beians[0]!
    return NextResponse.json({
      tags: tagsByBeian.get(beian) ?? [],
      pools: poolsByBeian.get(beian) ?? [],
    })
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
      [beian_hao, tag_name.trim(), user_name],
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
      [beian_hao, tag_name],
    )
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
