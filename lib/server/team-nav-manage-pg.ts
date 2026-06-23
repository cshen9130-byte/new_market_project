import { query } from "@/lib/db"
import {
  loadEmailNavManageRows,
  mergeNavSeriesWithEmail,
  type EmailNavPoint,
} from "@/lib/server/email-nav-query"

export type TeamNavManageRow = {
  id: string
  nav_date: string
  unit_nav: string
  cumulative_nav: string
  adjusted_nav: string | null
  price_change: string | null
  nav_source: string
  calculating: boolean
}

export type TeamNavUploadRow = {
  nav_date: string
  unit_nav: string
  cumulative_nav?: string
}

type ManualNavRow = {
  id: string
  nav_date: string
  unit_nav: string
  cumulative_nav: string | null
}

async function ensureTeamNavManualTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_nav_manual (
      id             SERIAL PRIMARY KEY,
      beian_hao      VARCHAR(64) NOT NULL,
      nav_date       DATE NOT NULL,
      unit_nav       NUMERIC(16,6) NOT NULL,
      cumulative_nav NUMERIC(16,6),
      nav_type       VARCHAR(16) NOT NULL DEFAULT 'pre_fee',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, nav_date, nav_type)
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ops_team_nav_manual_beian_date
      ON ops_team_nav_manual (beian_hao, nav_date DESC)
  `)
}

async function loadManualTeamNavRows(
  beian_hao: string,
  nav_type: "pre_fee" | "virtual",
): Promise<ManualNavRow[]> {
  await ensureTeamNavManualTable()
  return query<ManualNavRow>(
    `SELECT id::text AS id,
            nav_date::text AS nav_date,
            unit_nav::text AS unit_nav,
            cumulative_nav::text AS cumulative_nav
     FROM ops_team_nav_manual
     WHERE beian_hao = $1 AND nav_type = $2
     ORDER BY nav_date ASC`,
    [beian_hao, nav_type],
  )
}

function fmtNav4(v: string | null | undefined): string {
  if (!v?.trim()) return "—"
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toFixed(4) : "—"
}

function fmtPct(v: string | null | undefined): string | null {
  if (!v?.trim()) return null
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return null
  return `${n.toFixed(2)}%`
}

function isValidNavDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

function isValidNavNumber(value: string): boolean {
  const n = parseFloat(value.trim())
  return Number.isFinite(n) && n > 0
}

export async function uploadTeamNavRows(params: {
  beian_hao: string
  nav_type: "pre_fee" | "virtual"
  rows: TeamNavUploadRow[]
}): Promise<{ ok: true; count: number } | { error: "missing_fields" | "invalid_rows" }> {
  const beian_hao = params.beian_hao.trim()
  if (!beian_hao || params.rows.length === 0) return { error: "missing_fields" }

  const cleaned: TeamNavUploadRow[] = []
  for (const row of params.rows) {
    const nav_date = row.nav_date.trim()
    const unit_nav = row.unit_nav.trim()
    const cumulative_nav = (row.cumulative_nav ?? row.unit_nav).trim()
    if (!isValidNavDate(nav_date) || !isValidNavNumber(unit_nav)) {
      return { error: "invalid_rows" }
    }
    cleaned.push({ nav_date, unit_nav, cumulative_nav })
  }

  await ensureTeamNavManualTable()
  for (const row of cleaned) {
    await query(
      `INSERT INTO ops_team_nav_manual (beian_hao, nav_date, unit_nav, cumulative_nav, nav_type)
       VALUES ($1, $2::date, $3::numeric, $4::numeric, $5)
       ON CONFLICT (beian_hao, nav_date, nav_type) DO UPDATE SET
         unit_nav = EXCLUDED.unit_nav,
         cumulative_nav = EXCLUDED.cumulative_nav,
         created_at = NOW()`,
      [beian_hao, row.nav_date, row.unit_nav, row.cumulative_nav, params.nav_type],
    )
  }

  return { ok: true, count: cleaned.length }
}

export async function listTeamNavManageRows(params: {
  beian_hao: string
  product_name: string
  nav_type: "pre_fee" | "virtual"
}): Promise<TeamNavManageRow[]> {
  const [raw, manual] = await Promise.all([
    loadEmailNavManageRows(params.beian_hao, params.product_name, null, params.nav_type),
    loadManualTeamNavRows(params.beian_hao, params.nav_type),
  ])

  const manualDates = new Set(manual.map((row) => row.nav_date))
  const emailPoints: EmailNavPoint[] = raw
    .filter((row) => !manualDates.has(row.nav_date))
    .map((row) => ({
      price_date: row.nav_date,
      nav: row.nav,
      cumulative_nav: row.cumulative_nav,
    }))
  const manualPoints: EmailNavPoint[] = manual.map((row) => ({
    price_date: row.nav_date,
    nav: row.unit_nav,
    cumulative_nav: row.cumulative_nav ?? row.unit_nav,
  }))

  const merged = mergeNavSeriesWithEmail([], [...emailPoints, ...manualPoints])
  const sourceByDate = new Map<string, string>()
  for (const row of raw) {
    if (!manualDates.has(row.nav_date)) sourceByDate.set(row.nav_date, "邮箱抓取")
  }
  for (const row of manual) sourceByDate.set(row.nav_date, "手动上传")
  const idByDate = new Map<string, string>()
  for (const row of raw) idByDate.set(row.nav_date, row.id)
  for (const row of manual) idByDate.set(row.nav_date, `manual-${row.id}`)

  return merged.map((row, i, arr) => {
    const isLatest = i === arr.length - 1
    const adjusted = row.cum_nav_withdrawal?.trim() || row.cumulative_nav?.trim() || null
    const pct = fmtPct(row.price_change)
    const calculating = isLatest && (!adjusted || !pct)
    return {
      id: idByDate.get(row.price_date) ?? row.price_date,
      nav_date: row.price_date,
      unit_nav: fmtNav4(row.nav),
      cumulative_nav: fmtNav4(row.cumulative_nav || row.nav),
      adjusted_nav: calculating ? null : fmtNav4(adjusted),
      price_change: calculating ? null : pct,
      nav_source: sourceByDate.get(row.price_date) ?? "邮箱抓取",
      calculating,
    }
  }).reverse()
}
