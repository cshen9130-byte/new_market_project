import { randomUUID } from "crypto"
import { publicQuery } from "@/lib/db"

// Keep in sync with lib/fof-deeper-analysis.ts. Do not import that module here:
// it is used by Client Components, and a shared runtime import can make Next 16
// Turbopack treat the client chart graph as an async Client Component.
const DEFAULT_LS_NET_EXPOSURE_PCT = 20
const MAX_PRODUCT_RISK_WEIGHT_PCT = 300

export type HedgeWeightScope = "team" | "mine"

export type HedgeWeightPreset = {
  id: string
  parentBeian: string
  scope: HedgeWeightScope
  name: string
  lsNetAssumptionPct: number
  overrides: Record<string, number>
  createdBy: string
  createdByName: string
  updatedAt: string
}

const MAX_PRESETS_PER_SCOPE = 20

type DbRow = {
  id: string
  parent_beian: string
  scope: string
  user_id: string
  name: string
  ls_net_assumption_pct: string | number
  overrides: unknown
  created_by: string
  created_by_name: string
  updated_at: string | Date
}

let tableEnsured = false
let ensureInFlight: Promise<void> | null = null

function parseOverrides(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value)
    if (key && Number.isFinite(n) && n >= 0) {
      out[key] = Math.min(n, MAX_PRODUCT_RISK_WEIGHT_PCT)
    }
  }
  return out
}

function rowToPreset(row: DbRow): HedgeWeightPreset {
  const ls = Number(row.ls_net_assumption_pct)
  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : String(row.updated_at ?? "")
  return {
    id: row.id,
    parentBeian: row.parent_beian,
    scope: row.scope === "mine" ? "mine" : "team",
    name: row.name,
    lsNetAssumptionPct: Number.isFinite(ls) && ls >= 0 ? ls : DEFAULT_LS_NET_EXPOSURE_PCT,
    overrides: parseOverrides(row.overrides),
    createdBy: row.created_by ?? "",
    createdByName: row.created_by_name ?? "",
    updatedAt,
  }
}

async function ensureTable(): Promise<void> {
  if (tableEnsured) return
  if (ensureInFlight) return ensureInFlight
  ensureInFlight = (async () => {
    const exists = await publicQuery(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'fof_hedge_weight_presets'
       LIMIT 1`,
    ).then((res) => res.rows as { ok: number }[]).catch(() => [] as { ok: number }[])
    if (exists.length > 0) {
      tableEnsured = true
      return
    }
    try {
      await publicQuery(`
        CREATE TABLE IF NOT EXISTS public.fof_hedge_weight_presets (
          id TEXT PRIMARY KEY,
          parent_beian VARCHAR(128) NOT NULL,
          scope VARCHAR(16) NOT NULL,
          user_id VARCHAR(255) NOT NULL DEFAULT '',
          name VARCHAR(255) NOT NULL,
          ls_net_assumption_pct NUMERIC NOT NULL DEFAULT 20,
          overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by VARCHAR(255) NOT NULL DEFAULT '',
          created_by_name VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      await publicQuery(`
        CREATE UNIQUE INDEX IF NOT EXISTS fof_hedge_weight_presets_uniq
        ON public.fof_hedge_weight_presets (parent_beian, scope, user_id, lower(name))
      `)
      tableEnsured = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `fof_hedge_weight_presets 表不可用（${msg}）。请用 postgres 超级用户执行 scripts/db/020_fof_hedge_weight_presets.sql`,
      )
    }
  })().finally(() => {
    ensureInFlight = null
  })
  return ensureInFlight
}

function scopeUserId(scope: HedgeWeightScope, userId: string): string {
  return scope === "mine" ? userId : ""
}

async function q<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const res = await publicQuery(sql, params)
  return res.rows as T[]
}

export async function listHedgeWeightPresets(
  parentBeian: string,
  userId: string,
): Promise<{ team: HedgeWeightPreset[]; mine: HedgeWeightPreset[] }> {
  await ensureTable()
  const rows = await q<DbRow>(
    `SELECT id, parent_beian, scope, user_id, name, ls_net_assumption_pct, overrides,
            created_by, created_by_name, updated_at
     FROM public.fof_hedge_weight_presets
     WHERE parent_beian = $1
       AND (scope = 'team' OR (scope = 'mine' AND user_id = $2))
     ORDER BY updated_at DESC`,
    [parentBeian, userId],
  )
  const team: HedgeWeightPreset[] = []
  const mine: HedgeWeightPreset[] = []
  for (const row of rows) {
    const preset = rowToPreset(row)
    if (preset.scope === "mine") mine.push(preset)
    else team.push(preset)
  }
  return { team, mine }
}

export async function upsertHedgeWeightPreset(input: {
  parentBeian: string
  scope: HedgeWeightScope
  userId: string
  userName: string
  name: string
  lsNetAssumptionPct: number
  overrides: Record<string, number>
}): Promise<HedgeWeightPreset> {
  await ensureTable()
  const name = input.name.trim().slice(0, 80)
  if (!name) throw new Error("方案名称不能为空")
  const userKey = scopeUserId(input.scope, input.userId)
  const ls = Number.isFinite(input.lsNetAssumptionPct) && input.lsNetAssumptionPct >= 0
    ? Math.min(input.lsNetAssumptionPct, MAX_PRODUCT_RISK_WEIGHT_PCT)
    : DEFAULT_LS_NET_EXPOSURE_PCT
  const overrides = parseOverrides(input.overrides)

  const existing = (await q<DbRow>(
    `SELECT id, parent_beian, scope, user_id, name, ls_net_assumption_pct, overrides,
            created_by, created_by_name, updated_at
     FROM public.fof_hedge_weight_presets
     WHERE parent_beian = $1 AND scope = $2 AND user_id = $3 AND lower(name) = lower($4)
     LIMIT 1`,
    [input.parentBeian, input.scope, userKey, name],
  ))[0] ?? null

  if (existing) {
    const updated = (await q<DbRow>(
      `UPDATE public.fof_hedge_weight_presets
       SET name = $2,
           ls_net_assumption_pct = $3,
           overrides = $4::jsonb,
           created_by_name = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, parent_beian, scope, user_id, name, ls_net_assumption_pct, overrides,
                 created_by, created_by_name, updated_at`,
      [existing.id, name, ls, JSON.stringify(overrides), input.userName],
    ))[0]
    return rowToPreset(updated)
  }

  const countRows = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.fof_hedge_weight_presets
     WHERE parent_beian = $1 AND scope = $2 AND user_id = $3`,
    [input.parentBeian, input.scope, userKey],
  )
  if (Number(countRows[0]?.n ?? 0) >= MAX_PRESETS_PER_SCOPE) {
    throw new Error(`${input.scope === "team" ? "团队" : "我的"}方案最多保存 ${MAX_PRESETS_PER_SCOPE} 个`)
  }

  const inserted = (await q<DbRow>(
    `INSERT INTO public.fof_hedge_weight_presets (
       id, parent_beian, scope, user_id, name, ls_net_assumption_pct, overrides,
       created_by, created_by_name
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     RETURNING id, parent_beian, scope, user_id, name, ls_net_assumption_pct, overrides,
               created_by, created_by_name, updated_at`,
    [
      randomUUID(),
      input.parentBeian,
      input.scope,
      userKey,
      name,
      ls,
      JSON.stringify(overrides),
      input.userId,
      input.userName,
    ],
  ))[0]
  return rowToPreset(inserted)
}

export async function deleteHedgeWeightPreset(input: {
  id: string
  userId: string
}): Promise<boolean> {
  await ensureTable()
  const rows = await q<{ id: string; scope: string; user_id: string }>(
    `SELECT id, scope, user_id FROM public.fof_hedge_weight_presets WHERE id = $1`,
    [input.id],
  )
  const row = rows[0]
  if (!row) return false
  if (row.scope === "mine" && row.user_id !== input.userId) return false
  await publicQuery(`DELETE FROM public.fof_hedge_weight_presets WHERE id = $1`, [input.id])
  return true
}
