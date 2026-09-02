import { query } from "@/lib/db"
import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"
import {
  loadEmailNavManagePoints,
  loadEmailNavManageRows,
  mergeNavSeriesWithEmail,
  type EmailNavPoint,
  type LegacyNavRow,
} from "@/lib/server/email-nav-query"
import {
  loadManagedProductNavSeed,
  type TeamNavListPoint,
} from "@/lib/server/managed-product-nav-seed"

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
  /** 复权净值 from upload file when present */
  adjusted_nav?: string
}

type ManualNavRow = {
  id: string
  nav_date: string
  unit_nav: string
  cumulative_nav: string | null
  adjusted_nav: string | null
}

let teamNavManualTableReady = false

async function ensureTeamNavManualTable(): Promise<void> {
  if (teamNavManualTableReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_nav_manual (
      id             SERIAL PRIMARY KEY,
      beian_hao      VARCHAR(64) NOT NULL,
      nav_date       DATE NOT NULL,
      unit_nav       NUMERIC(16,6) NOT NULL,
      cumulative_nav NUMERIC(16,6),
      adjusted_nav   NUMERIC(16,6),
      nav_type       VARCHAR(16) NOT NULL DEFAULT 'pre_fee',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, nav_date, nav_type)
    )
  `)
  try {
    await query(`
      ALTER TABLE ops_team_nav_manual
        ADD COLUMN IF NOT EXISTS adjusted_nav NUMERIC(16,6)
    `)
  } catch (err) {
    // Older DBs created the table without adjusted_nav; uploads/detail merge need it.
    console.error("[team-nav-manual] failed to add adjusted_nav column:", err)
  }
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ops_team_nav_manual_beian_date
      ON ops_team_nav_manual (beian_hao, nav_date DESC)
  `)
  teamNavManualTableReady = true
}

const TEAM_NAV_TIP_DATES = 10

/** Exact 备案号 plus S-prefix / stripped-S aliases (no A/B/C sibling mix). */
export function teamNavBeianLookupCodes(beian: string): string[] {
  const u = beian.trim().toUpperCase()
  if (!u) return []
  const out = new Set<string>([u])
  if (u.startsWith("S") && u.length > 5) out.add(u.slice(1))
  else out.add(`S${u}`)
  if (u.startsWith("S") && !u.startsWith("SS")) out.add(`S${u}`)
  return [...out]
}

function normalizeBeianKey(beian: string): string {
  return beian.trim().toUpperCase()
}

/** Latest team/email NAV points only — for list overlays (not full history). */
export async function loadManagedProductTeamNavTips(
  items: Array<{ beian_hao: string; product_name: string; short_name?: string | null }>,
  asOfDate: string,
): Promise<Map<string, Array<{ nav_date: string; unit_nav: string }>>> {
  const out = new Map<string, Array<{ nav_date: string; unit_nav: string }>>()
  if (items.length === 0) return out

  const codes = [...new Set(items.map((item) => item.beian_hao.trim()).filter(Boolean))]
  if (codes.length === 0) return out

  const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(asOfDate)
    ? asOfDate
    : new Date().toISOString().slice(0, 10)

  const [manualMap, emailRows] = await Promise.all([
    loadManualTeamNavBatch(codes),
    query<{ code: string; nav_date: string; nav: string }>(
      `SELECT code, nav_date::text AS nav_date, nav::text AS nav
       FROM (
         SELECT
           product_code AS code,
           nav_date,
           nav,
           ROW_NUMBER() OVER (
             PARTITION BY product_code
             ORDER BY nav_date DESC, id DESC
           ) AS rn
         FROM ops_email_nav_records
         WHERE product_code = ANY($1::text[])
           AND nav_date <= $2::date
           AND nav IS NOT NULL
           AND nav > 0
       ) t
       WHERE rn <= $3
       ORDER BY code, nav_date ASC`,
      [codes, cutoff, TEAM_NAV_TIP_DATES],
    ).catch((err) => {
      console.warn("[team-nav-tips] email load failed:", err)
      return [] as Array<{ code: string; nav_date: string; nav: string }>
    }),
  ])

  const emailByCode = new Map<string, Array<{ nav_date: string; unit_nav: string }>>()
  for (const row of emailRows) {
    const code = (row.code ?? "").trim()
    if (!code) continue
    const list = emailByCode.get(code) ?? []
    list.push({ nav_date: row.nav_date.slice(0, 10), unit_nav: row.nav })
    emailByCode.set(code, list)
  }

  for (const code of codes) {
    const byDate = new Map<string, string>()
    for (const point of emailByCode.get(code) ?? []) {
      byDate.set(point.nav_date, point.unit_nav)
    }
    for (const point of manualMap.get(code) ?? []) {
      const navDate = point.nav_date.slice(0, 10)
      if (navDate > cutoff) continue
      byDate.set(navDate, point.unit_nav)
    }
    const series = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([nav_date, unit_nav]) => ({ nav_date, unit_nav }))
    if (series.length > 0) out.set(code, series)
  }

  return out
}

/** Batch-load manual team NAV for list-cache / managed-product list overlays. */
export async function loadManualTeamNavBatch(
  beianHaos: string[],
  nav_type: "pre_fee" | "virtual" = "pre_fee",
): Promise<Map<string, TeamNavListPoint[]>> {
  await ensureTeamNavManualTable()
  const requested = [...new Set(beianHaos.map((b) => b.trim()).filter(Boolean))]
  const out = new Map<string, TeamNavListPoint[]>()
  if (requested.length === 0) return out

  const lookupCodes = [...new Set(requested.flatMap((b) => teamNavBeianLookupCodes(b)))]
  const rows = await query<{
    beian_hao: string
    nav_date: string
    unit_nav: string
    cumulative_nav: string | null
    adjusted_nav: string | null
  }>(
    `SELECT beian_hao,
            nav_date::text AS nav_date,
            unit_nav::text AS unit_nav,
            cumulative_nav::text AS cumulative_nav,
            adjusted_nav::text AS adjusted_nav
     FROM ops_team_nav_manual
     WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[]) AND nav_type = $2
     ORDER BY beian_hao, nav_date ASC`,
    [lookupCodes, nav_type],
  )

  const byStored = new Map<string, TeamNavListPoint[]>()
  for (const row of rows) {
    const stored = normalizeBeianKey(row.beian_hao)
    const list = byStored.get(stored) ?? []
    list.push({
      nav_date: row.nav_date.slice(0, 10),
      unit_nav: row.unit_nav,
      cumulative_nav: row.cumulative_nav,
      adjusted_nav: row.adjusted_nav,
    })
    byStored.set(stored, list)
  }

  for (const req of requested) {
    const family = new Set(teamNavBeianLookupCodes(req))
    const byDate = new Map<string, TeamNavListPoint>()
    for (const [stored, points] of byStored) {
      if (!family.has(stored)) continue
      for (const point of points) byDate.set(point.nav_date.slice(0, 10), point)
    }
    const series = [...byDate.values()].sort((a, b) => a.nav_date.localeCompare(b.nav_date))
    if (series.length === 0) continue
    out.set(req, series)
    out.set(normalizeBeianKey(req), series)
  }
  return out
}

export function manualNavPointsForBeian(
  map: Map<string, TeamNavListPoint[]>,
  beian: string,
): TeamNavListPoint[] {
  return map.get(beian)
    ?? map.get(beian.trim())
    ?? map.get(normalizeBeianKey(beian))
    ?? []
}

function upsertTeamNavPoint(
  byDate: Map<string, TeamNavListPoint>,
  point: TeamNavListPoint,
  overwriteUnit: boolean,
): void {
  const nav_date = point.nav_date.slice(0, 10)
  const prev = byDate.get(nav_date)
  byDate.set(nav_date, {
    nav_date,
    unit_nav: overwriteUnit || !prev ? point.unit_nav : prev.unit_nav,
    cumulative_nav: point.cumulative_nav ?? prev?.cumulative_nav ?? null,
    adjusted_nav: point.adjusted_nav ?? prev?.adjusted_nav ?? null,
  })
}

/**
 * Team NAV series keyed by beian for list overlays / managed-product cache rebuild.
 *
 * Batched: one manual-table query + one email-table query for all codes.
 * (Previously N× loadManagedProductNavSeries — pegged next-server when ops
 * tracking list overlaid team NAV for a full page of funds.)
 */
export async function loadManagedProductTeamNavBatch(
  items: Array<{ beian_hao: string; product_name: string; short_name?: string | null }>,
): Promise<Map<string, TeamNavListPoint[]>> {
  const out = new Map<string, TeamNavListPoint[]>()
  if (items.length === 0) return out

  const codes = [...new Set(items.map((item) => item.beian_hao.trim()).filter(Boolean))]
  if (codes.length === 0) return out

  const [manualMap, emailRows] = await Promise.all([
    loadManualTeamNavBatch(codes),
    query<{
      code: string
      nav_date: string
      nav: string
      cumulative_nav: string | null
      adjusted_nav: string | null
    }>(
      `SELECT DISTINCT ON (BTRIM(product_code), nav_date)
              BTRIM(product_code) AS code,
              nav_date::text AS nav_date,
              nav::text AS nav,
              cumulative_nav::text AS cumulative_nav,
              adjusted_nav::text AS adjusted_nav
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = ANY($1::text[])
         AND nav IS NOT NULL
         AND nav > 0
       ORDER BY BTRIM(product_code), nav_date, id DESC`,
      [codes],
    ).catch((err) => {
      console.warn("[team-nav-batch] email load failed:", err)
      return [] as Array<{
        code: string
        nav_date: string
        nav: string
        cumulative_nav: string | null
        adjusted_nav: string | null
      }>
    }),
  ])

  const emailByCode = new Map<string, TeamNavListPoint[]>()
  for (const row of emailRows) {
    const code = (row.code ?? "").trim()
    if (!code) continue
    const list = emailByCode.get(code) ?? []
    list.push({
      nav_date: row.nav_date.slice(0, 10),
      unit_nav: row.nav,
      cumulative_nav: row.cumulative_nav,
      adjusted_nav: row.adjusted_nav,
    })
    emailByCode.set(code, list)
  }

  for (const code of codes) {
    const byDate = new Map<string, TeamNavListPoint>()
    for (const point of emailByCode.get(code) ?? []) {
      upsertTeamNavPoint(byDate, point, true)
    }
    // Manual upload wins unit on the same date (matches loadManagedProductEmailPoints).
    for (const point of manualMap.get(code) ?? []) {
      upsertTeamNavPoint(byDate, { ...point, nav_date: point.nav_date.slice(0, 10) }, true)
    }
    const series = [...byDate.values()].sort((a, b) => a.nav_date.localeCompare(b.nav_date))
    out.set(code, series)
  }

  return out
}

/** Post-seed NAV extensions for managed-product overrides (email + manual team). */
export async function loadManagedProductPostSeedExtensions(
  beianHaos: string[],
): Promise<Map<string, TeamNavListPoint[]>> {
  const codes = [...new Set(beianHaos.map((b) => b.trim()).filter(Boolean))]
  const out = new Map<string, TeamNavListPoint[]>()
  if (codes.length === 0) return out

  const seedLatestByBeian = new Map<string, string>()
  for (const code of codes) {
    const seed = loadManagedProductNavSeed(code)
    if (seed.length === 0) continue
    seedLatestByBeian.set(code, seed[seed.length - 1].price_date)
  }
  if (seedLatestByBeian.size === 0) return out

  const minSeedLatest = [...seedLatestByBeian.values()].sort()[0]
  const [teamMap, emailRows] = await Promise.all([
    loadManualTeamNavBatch(codes),
    query<{
      code: string
      nav_date: string
      nav: string
      cumulative_nav: string | null
      adjusted_nav: string | null
    }>(
      `SELECT DISTINCT ON (BTRIM(product_code), nav_date)
              BTRIM(product_code) AS code,
              nav_date::text AS nav_date,
              nav::text AS nav,
              cumulative_nav::text AS cumulative_nav,
              adjusted_nav::text AS adjusted_nav
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = ANY($1::text[])
         AND nav_date > $2::date
         AND nav > 0
       ORDER BY BTRIM(product_code), nav_date, id DESC`,
      [codes, minSeedLatest],
    ),
  ])

  for (const code of codes) {
    const seedLatest = seedLatestByBeian.get(code)
    if (!seedLatest) continue
    const byDate = new Map<string, TeamNavListPoint>()
    for (const row of emailRows) {
      const nav_date = row.nav_date.slice(0, 10)
      if (row.code !== code || nav_date <= seedLatest) continue
      if (!isChinaTradingDay(nav_date)) continue
      upsertTeamNavPoint(byDate, {
        nav_date,
        unit_nav: row.nav,
        cumulative_nav: row.cumulative_nav,
        adjusted_nav: row.adjusted_nav,
      }, true)
    }
    for (const row of teamMap.get(code) ?? []) {
      const nav_date = row.nav_date.slice(0, 10)
      if (nav_date <= seedLatest || !isChinaTradingDay(nav_date)) continue
      upsertTeamNavPoint(byDate, { ...row, nav_date }, true)
    }
    out.set(
      code,
      [...byDate.values()].sort((a, b) => a.nav_date.localeCompare(b.nav_date)),
    )
  }
  return out
}

async function loadManualTeamNavRows(
  beian_hao: string,
  nav_type: "pre_fee" | "virtual",
): Promise<ManualNavRow[]> {
  await ensureTeamNavManualTable()
  const lookupCodes = teamNavBeianLookupCodes(beian_hao)
  if (lookupCodes.length === 0) return []
  const rows = await query<ManualNavRow>(
    `SELECT id::text AS id,
            nav_date::text AS nav_date,
            unit_nav::text AS unit_nav,
            cumulative_nav::text AS cumulative_nav,
            adjusted_nav::text AS adjusted_nav
     FROM ops_team_nav_manual
     WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[]) AND nav_type = $2
     ORDER BY nav_date ASC, id ASC`,
    [lookupCodes, nav_type],
  )
  const byDate = new Map<string, ManualNavRow>()
  for (const row of rows) {
    byDate.set(row.nav_date.slice(0, 10), {
      ...row,
      nav_date: row.nav_date.slice(0, 10),
    })
  }
  return [...byDate.values()].sort((a, b) => a.nav_date.localeCompare(b.nav_date))
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

function normalizeNavDate(value: string): string | null {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const m = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}

function isValidNavDate(value: string): boolean {
  return normalizeNavDate(value) !== null
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
    const nav_date = normalizeNavDate(row.nav_date)
    const unit_nav = row.unit_nav.trim()
    const cumulative_nav = (row.cumulative_nav ?? row.unit_nav).trim()
    const adjustedRaw = row.adjusted_nav?.trim() ?? ""
    const adjusted_nav = adjustedRaw && isValidNavNumber(adjustedRaw) ? adjustedRaw : undefined
    if (!nav_date || !isValidNavNumber(unit_nav)) {
      return { error: "invalid_rows" }
    }
    cleaned.push({ nav_date, unit_nav, cumulative_nav, adjusted_nav })
  }

  await ensureTeamNavManualTable()
  for (const row of cleaned) {
    await query(
      `INSERT INTO ops_team_nav_manual (beian_hao, nav_date, unit_nav, cumulative_nav, adjusted_nav, nav_type)
       VALUES ($1, $2::date, $3::numeric, $4::numeric, $5::numeric, $6)
       ON CONFLICT (beian_hao, nav_date, nav_type) DO UPDATE SET
         unit_nav = EXCLUDED.unit_nav,
         cumulative_nav = EXCLUDED.cumulative_nav,
         adjusted_nav = EXCLUDED.adjusted_nav,
         created_at = NOW()`,
      [
        beian_hao,
        row.nav_date,
        row.unit_nav,
        row.cumulative_nav,
        row.adjusted_nav ?? null,
        params.nav_type,
      ],
    )
  }

  return { ok: true, count: cleaned.length }
}

export async function deleteTeamNavRow(params: {
  beian_hao: string
  nav_type: "pre_fee" | "virtual"
  nav_date: string
  row_id: string
}): Promise<{ ok: true } | { error: "missing_fields" | "not_found" }> {
  const beian_hao = params.beian_hao.trim()
  const nav_date = params.nav_date.trim()
  const row_id = params.row_id.trim()
  if (!beian_hao || !nav_date || !row_id || !isValidNavDate(nav_date)) {
    return { error: "missing_fields" }
  }

  if (row_id.startsWith("platform-") || row_id.startsWith("seed-")) {
    return { error: "not_found" }
  }

  if (row_id.startsWith("manual-")) {
    const manualId = row_id.slice("manual-".length)
    await ensureTeamNavManualTable()
    const deleted = await query<{ id: string }>(
      `DELETE FROM ops_team_nav_manual
       WHERE id = $1::int AND beian_hao = $2 AND nav_date = $3::date AND nav_type = $4
       RETURNING id::text AS id`,
      [manualId, beian_hao, nav_date, params.nav_type],
    )
    if (deleted.length === 0) return { error: "not_found" }
    return { ok: true }
  }

  const deleted = await query<{ id: string }>(
    `DELETE FROM ops_email_nav_records
     WHERE id = $1::int AND nav_date = $2::date
     RETURNING id::text AS id`,
    [row_id, nav_date],
  )
  if (deleted.length === 0) return { error: "not_found" }
  return { ok: true }
}

export async function clearAllTeamNavRows(params: {
  beian_hao: string
  product_name: string
  nav_type: "pre_fee" | "virtual"
}): Promise<{ ok: true; count: number } | { error: "missing_fields" }> {
  const beian_hao = params.beian_hao.trim()
  if (!beian_hao) return { error: "missing_fields" }

  const rows = await listTeamNavManageRows(params)

  await ensureTeamNavManualTable()
  await query(
    `DELETE FROM ops_team_nav_manual WHERE beian_hao = $1 AND nav_type = $2`,
    [beian_hao, params.nav_type],
  )

  let count = 0
  for (const row of rows) {
    if (row.id.startsWith("manual-")) {
      count++
      continue
    }
    const deleted = await query<{ id: string }>(
      `DELETE FROM ops_email_nav_records
       WHERE id = $1::int AND nav_date = $2::date
       RETURNING id::text AS id`,
      [row.id, row.nav_date],
    )
    if (deleted.length > 0) count++
  }

  return { ok: true, count }
}

export type TeamNavMonitorFrequency = "daily" | "weekly" | "monthly"

export type TeamNavMissingSettings = {
  inception_date: string | null
  nav_start_date: string | null
  latest_nav_date: string | null
  monitor_frequency: TeamNavMonitorFrequency
  monitor_start_date: string | null
  monitor_enabled: boolean
}

function normalizeMonitorFrequency(value: string | null | undefined): TeamNavMonitorFrequency {
  if (value === "weekly" || value === "monthly") return value
  return "daily"
}

async function ensureTeamNavMissingSettingsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_nav_missing_settings (
      id                  SERIAL PRIMARY KEY,
      beian_hao           VARCHAR(64) NOT NULL,
      nav_type            VARCHAR(16) NOT NULL DEFAULT 'pre_fee',
      monitor_frequency   VARCHAR(16) NOT NULL DEFAULT 'daily',
      monitor_start_date  DATE,
      monitor_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, nav_type)
    )
  `)
}

export async function getTeamNavMissingSettings(params: {
  beian_hao: string
  product_name: string
  nav_type: "pre_fee" | "virtual"
}): Promise<TeamNavMissingSettings> {
  const beian_hao = params.beian_hao.trim()
  const infoRows = await query<{ inception_date: string | null }>(
    `SELECT inception_date::text AS inception_date
     FROM private_fund_info
     WHERE beian_hao = $1
     LIMIT 1`,
    [beian_hao],
  )
  const navRows = await listTeamNavManageRows(params)
  const nav_start_date = navRows.length > 0 ? navRows[navRows.length - 1].nav_date : null
  const latest_nav_date = navRows.length > 0 ? navRows[0].nav_date : null

  await ensureTeamNavMissingSettingsTable()
  const saved = await query<{
    monitor_frequency: string
    monitor_start_date: string | null
    monitor_enabled: boolean
  }>(
    `SELECT monitor_frequency,
            monitor_start_date::text AS monitor_start_date,
            monitor_enabled
     FROM ops_team_nav_missing_settings
     WHERE beian_hao = $1 AND nav_type = $2
     LIMIT 1`,
    [beian_hao, params.nav_type],
  )

  return {
    inception_date: infoRows[0]?.inception_date?.slice(0, 10) ?? null,
    nav_start_date,
    latest_nav_date,
    monitor_frequency: normalizeMonitorFrequency(saved[0]?.monitor_frequency),
    monitor_start_date: saved[0]?.monitor_start_date?.slice(0, 10) ?? null,
    monitor_enabled: saved[0]?.monitor_enabled ?? true,
  }
}

export async function saveTeamNavMissingSettings(params: {
  beian_hao: string
  nav_type: "pre_fee" | "virtual"
  monitor_frequency: TeamNavMonitorFrequency
  monitor_start_date: string
  monitor_enabled: boolean
}): Promise<{ ok: true } | { error: "missing_fields" | "invalid_date" | "invalid_frequency" }> {
  const beian_hao = params.beian_hao.trim()
  const monitor_start_date = params.monitor_start_date.trim()
  if (!beian_hao) return { error: "missing_fields" }
  if (!["daily", "weekly", "monthly"].includes(params.monitor_frequency)) {
    return { error: "invalid_frequency" }
  }
  if (params.monitor_enabled && !isValidNavDate(monitor_start_date)) {
    return { error: "invalid_date" }
  }

  await ensureTeamNavMissingSettingsTable()
  await query(
    `INSERT INTO ops_team_nav_missing_settings (
       beian_hao, nav_type, monitor_frequency, monitor_start_date, monitor_enabled, updated_at
     ) VALUES ($1, $2, $3, $4::date, $5, NOW())
     ON CONFLICT (beian_hao, nav_type) DO UPDATE SET
       monitor_frequency = EXCLUDED.monitor_frequency,
       monitor_start_date = EXCLUDED.monitor_start_date,
       monitor_enabled = EXCLUDED.monitor_enabled,
       updated_at = NOW()`,
    [
      beian_hao,
      params.nav_type,
      params.monitor_frequency,
      params.monitor_enabled ? monitor_start_date : null,
      params.monitor_enabled,
    ],
  )

  return { ok: true }
}

/** Email + manual NAV points for 在管产品 (corrected stream, not yet merged with seed). */
export async function loadManagedProductEmailPoints(params: {
  beian_hao: string
  product_name: string
  short_name?: string | null
  nav_type?: "pre_fee" | "virtual"
  extraNames?: Array<string | null | undefined>
}): Promise<EmailNavPoint[]> {
  const nav_type = params.nav_type ?? "pre_fee"
  const extraNames = params.extraNames ?? []
  const [emailPoints, manual] = await Promise.all([
    loadEmailNavManagePoints(
      params.beian_hao,
      params.product_name,
      params.short_name ?? null,
      nav_type,
      extraNames,
    ),
    loadManualTeamNavRows(params.beian_hao, nav_type),
  ])

  const manualDates = new Set(manual.map((row) => row.nav_date))
  // Manual upload owns its [min, max] window so mid-week email scraps cannot
  // intercalate between weekly rows and sawtooth the 复权 chart. Email may still
  // extend *after* the last manual date for ongoing auto-updates.
  const manualMin = manual[0]?.nav_date ?? ""
  const manualMax = manual[manual.length - 1]?.nav_date ?? ""
  const filteredEmail = emailPoints.filter((row) => {
    if (manualDates.has(row.price_date)) return false
    if (manual.length >= 10 && manualMin && manualMax) {
      return row.price_date < manualMin || row.price_date > manualMax
    }
    return true
  })
  const manualPoints: EmailNavPoint[] = manual.map((row) => ({
    price_date: row.nav_date,
    nav: row.unit_nav,
    cumulative_nav: row.cumulative_nav ?? row.unit_nav,
    adjusted_nav: row.adjusted_nav,
  }))

  return [...filteredEmail, ...manualPoints].sort((a, b) =>
    a.price_date.localeCompare(b.price_date),
  )
}

/** Team / manual NAV stream for 在管产品 — avoids corrupt legacy type6 rows. */
export async function loadManagedProductNavSeries(params: {
  beian_hao: string
  product_name: string
  short_name?: string | null
  nav_type?: "pre_fee" | "virtual"
  extraNames?: Array<string | null | undefined>
}): Promise<LegacyNavRow[]> {
  const points = await loadManagedProductEmailPoints(params)
  return mergeNavSeriesWithEmail([], points)
}

function overlayNavSeriesByDate(base: LegacyNavRow[], overlay: LegacyNavRow[]): LegacyNavRow[] {
  if (overlay.length === 0) return base
  if (base.length === 0) return overlay
  const byDate = new Map<string, LegacyNavRow>()
  for (const row of base) byDate.set(row.price_date.slice(0, 10), row)
  for (const row of overlay) byDate.set(row.price_date.slice(0, 10), row)
  return [...byDate.values()].sort((a, b) => a.price_date.localeCompare(b.price_date))
}

/** Same series the product page / FOF list tip uses (platform + 估值表 extend). */
async function loadPlatformNavManageSeries(params: {
  beian_hao: string
  product_name: string
}): Promise<LegacyNavRow[]> {
  const { loadDetailNavSeriesFast } = await import("@/lib/server/fund-detail-fast-path")
  const { resolveFundNames } = await import("@/lib/server/fund-nav-series")
  const names = await resolveFundNames(params.beian_hao, params.product_name)
  return loadDetailNavSeriesFast({
    beian_hao: params.beian_hao,
    product_name: names.product_name || params.product_name,
    short_name: names.short_name || "",
  })
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

  const teamMerged = await loadManagedProductNavSeries(params)
  let platform: LegacyNavRow[] = []
  if (params.nav_type === "pre_fee") {
    try {
      platform = await loadPlatformNavManageSeries(params)
    } catch (err) {
      console.warn("[team-nav-manage] platform series failed:", err)
    }
  }
  const merged = overlayNavSeriesByDate(platform, teamMerged)

  const manualDates = new Set(manual.map((row) => row.nav_date))
  const platformDates = new Set(platform.map((row) => row.price_date.slice(0, 10)))
  const sourceByDate = new Map<string, string>()
  for (const date of platformDates) sourceByDate.set(date, "平台净值")
  for (const row of raw) {
    if (!manualDates.has(row.nav_date)) sourceByDate.set(row.nav_date, "邮箱抓取")
  }
  for (const row of manual) sourceByDate.set(row.nav_date, "手动上传")
  const idByDate = new Map<string, string>()
  for (const date of platformDates) idByDate.set(date, `platform-${date}`)
  for (const row of raw) idByDate.set(row.nav_date, row.id)
  for (const row of manual) idByDate.set(row.nav_date, `manual-${row.id}`)

  return merged.map((row, i, arr) => {
    const isLatest = i === arr.length - 1
    const navDate = row.price_date.slice(0, 10)
    // LegacyNavRow: cumulative_nav = 复权, cum_nav_withdrawal = 累计
    const cum = row.cum_nav_withdrawal?.trim() || row.nav?.trim() || null
    const adjusted = row.cumulative_nav?.trim() || row.cum_nav_withdrawal?.trim() || null
    const pct = fmtPct(row.price_change)
    const calculating = isLatest && (!adjusted || !pct)
    return {
      id: idByDate.get(navDate) ?? navDate,
      nav_date: navDate,
      unit_nav: fmtNav4(row.nav),
      cumulative_nav: fmtNav4(cum),
      adjusted_nav: calculating ? null : fmtNav4(adjusted),
      price_change: calculating ? null : pct,
      nav_source: sourceByDate.get(navDate) ?? (platformDates.has(navDate) ? "平台净值" : "邮箱抓取"),
      calculating,
    }
  }).reverse()
}
