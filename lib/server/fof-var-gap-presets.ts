import { randomUUID } from "crypto"
import { publicQuery } from "@/lib/db"
import type { FofGapAction } from "@/lib/fof-portfolio-var"

export type VarGapScope = "team" | "mine"

export type VarGapPreset = {
  id: string
  parentBeian: string
  scope: VarGapScope
  name: string
  assumeVolPct: number
  assumeCorr: number
  overrides: Record<string, FofGapAction>
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
  assume_vol_pct: string | number
  assume_corr: string | number
  overrides: unknown
  created_by: string
  created_by_name: string
  updated_at: string | Date
}

let tableEnsured = false
let ensureInFlight: Promise<void> | null = null

export function parseVarGapActions(raw: unknown): Record<string, FofGapAction> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, FofGapAction> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== "object") continue
    const v = value as Record<string, unknown>
    if (v.kind === "ignore") {
      out[key] = { kind: "ignore" }
    } else if (v.kind === "proxy") {
      const proxyKey = String(v.proxyKey ?? "").trim()
      if (!proxyKey) continue
      out[key] = {
        kind: "proxy",
        proxyKey,
        proxyName: typeof v.proxyName === "string" ? v.proxyName : undefined,
      }
    } else if (v.kind === "assume") {
      const vol = Number(v.annVolPct)
      const corr = Number(v.corr)
      out[key] = {
        kind: "assume",
        annVolPct: Number.isFinite(vol) && vol >= 0 ? vol : 10,
        corr: Number.isFinite(corr) ? Math.max(-0.95, Math.min(0.95, corr)) : 0.3,
      }
    }
  }
  return out
}

function rowToPreset(row: DbRow): VarGapPreset {
  const vol = Number(row.assume_vol_pct)
  const corr = Number(row.assume_corr)
  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : String(row.updated_at ?? "")
  return {
    id: row.id,
    parentBeian: row.parent_beian,
    scope: row.scope === "mine" ? "mine" : "team",
    name: row.name,
    assumeVolPct: Number.isFinite(vol) && vol >= 0 ? vol : 10,
    assumeCorr: Number.isFinite(corr) ? corr : 0.3,
    overrides: parseVarGapActions(row.overrides),
    createdBy: row.created_by ?? "",
    createdByName: row.created_by_name ?? "",
    updatedAt,
  }
}

async function q<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const res = await publicQuery(sql, params)
  return res.rows as T[]
}

async function ensureTable(): Promise<void> {
  if (tableEnsured) return
  if (ensureInFlight) return ensureInFlight
  ensureInFlight = (async () => {
    const exists = await publicQuery(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'fof_var_gap_presets'
       LIMIT 1`,
    ).then((res) => res.rows as { ok: number }[]).catch(() => [] as { ok: number }[])
    if (exists.length > 0) {
      tableEnsured = true
      return
    }
    try {
      await publicQuery(`
        CREATE TABLE IF NOT EXISTS public.fof_var_gap_presets (
          id TEXT PRIMARY KEY,
          parent_beian VARCHAR(128) NOT NULL,
          scope VARCHAR(16) NOT NULL,
          user_id VARCHAR(255) NOT NULL DEFAULT '',
          name VARCHAR(255) NOT NULL,
          assume_vol_pct NUMERIC NOT NULL DEFAULT 10,
          assume_corr NUMERIC NOT NULL DEFAULT 0.3,
          overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by VARCHAR(255) NOT NULL DEFAULT '',
          created_by_name VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      await publicQuery(`
        CREATE UNIQUE INDEX IF NOT EXISTS fof_var_gap_presets_uniq
        ON public.fof_var_gap_presets (parent_beian, scope, user_id, lower(name))
      `)
      tableEnsured = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `fof_var_gap_presets 表不可用（${msg}）。请用 postgres 超级用户执行 scripts/db/021_fof_var_gap_presets.sql`,
      )
    }
  })().finally(() => {
    ensureInFlight = null
  })
  return ensureInFlight
}

function scopeUserId(scope: VarGapScope, userId: string): string {
  return scope === "mine" ? userId : ""
}

export async function listVarGapPresets(
  parentBeian: string,
  userId: string,
): Promise<{ team: VarGapPreset[]; mine: VarGapPreset[] }> {
  await ensureTable()
  const rows = await q<DbRow>(
    `SELECT id, parent_beian, scope, user_id, name, assume_vol_pct, assume_corr, overrides,
            created_by, created_by_name, updated_at
     FROM public.fof_var_gap_presets
     WHERE parent_beian = $1
       AND (scope = 'team' OR (scope = 'mine' AND user_id = $2))
     ORDER BY updated_at DESC`,
    [parentBeian, userId],
  )
  const team: VarGapPreset[] = []
  const mine: VarGapPreset[] = []
  for (const row of rows) {
    const preset = rowToPreset(row)
    if (preset.scope === "mine") mine.push(preset)
    else team.push(preset)
  }
  return { team, mine }
}

export async function upsertVarGapPreset(input: {
  parentBeian: string
  scope: VarGapScope
  userId: string
  userName: string
  name: string
  assumeVolPct: number
  assumeCorr: number
  overrides: Record<string, FofGapAction>
}): Promise<VarGapPreset> {
  await ensureTable()
  const name = input.name.trim().slice(0, 80)
  if (!name) throw new Error("方案名称不能为空")
  const userKey = scopeUserId(input.scope, input.userId)
  const assumeVolPct = Number.isFinite(input.assumeVolPct) && input.assumeVolPct >= 0
    ? input.assumeVolPct
    : 10
  const assumeCorr = Number.isFinite(input.assumeCorr)
    ? Math.max(-0.95, Math.min(0.95, input.assumeCorr))
    : 0.3
  const overrides = parseVarGapActions(input.overrides)

  const existing = (await q<DbRow>(
    `SELECT id, parent_beian, scope, user_id, name, assume_vol_pct, assume_corr, overrides,
            created_by, created_by_name, updated_at
     FROM public.fof_var_gap_presets
     WHERE parent_beian = $1 AND scope = $2 AND user_id = $3 AND lower(name) = lower($4)
     LIMIT 1`,
    [input.parentBeian, input.scope, userKey, name],
  ))[0] ?? null

  if (existing) {
    const updated = (await q<DbRow>(
      `UPDATE public.fof_var_gap_presets
       SET name = $2,
           assume_vol_pct = $3,
           assume_corr = $4,
           overrides = $5::jsonb,
           created_by_name = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, parent_beian, scope, user_id, name, assume_vol_pct, assume_corr, overrides,
                 created_by, created_by_name, updated_at`,
      [existing.id, name, assumeVolPct, assumeCorr, JSON.stringify(overrides), input.userName],
    ))[0]
    return rowToPreset(updated)
  }

  const countRows = await q<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.fof_var_gap_presets
     WHERE parent_beian = $1 AND scope = $2 AND user_id = $3`,
    [input.parentBeian, input.scope, userKey],
  )
  if (Number(countRows[0]?.n ?? 0) >= MAX_PRESETS_PER_SCOPE) {
    throw new Error(`${input.scope === "team" ? "团队" : "我的"}方案最多保存 ${MAX_PRESETS_PER_SCOPE} 个`)
  }

  const inserted = (await q<DbRow>(
    `INSERT INTO public.fof_var_gap_presets (
       id, parent_beian, scope, user_id, name, assume_vol_pct, assume_corr, overrides,
       created_by, created_by_name
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     RETURNING id, parent_beian, scope, user_id, name, assume_vol_pct, assume_corr, overrides,
               created_by, created_by_name, updated_at`,
    [
      randomUUID(),
      input.parentBeian,
      input.scope,
      userKey,
      name,
      assumeVolPct,
      assumeCorr,
      JSON.stringify(overrides),
      input.userId,
      input.userName,
    ],
  ))[0]
  return rowToPreset(inserted)
}

export async function deleteVarGapPreset(input: {
  id: string
  userId: string
}): Promise<boolean> {
  await ensureTable()
  const rows = await q<{ id: string; scope: string; user_id: string }>(
    `SELECT id, scope, user_id FROM public.fof_var_gap_presets WHERE id = $1`,
    [input.id],
  )
  const row = rows[0]
  if (!row) return false
  if (row.scope === "mine" && row.user_id !== input.userId) return false
  await publicQuery(`DELETE FROM public.fof_var_gap_presets WHERE id = $1`, [input.id])
  return true
}
