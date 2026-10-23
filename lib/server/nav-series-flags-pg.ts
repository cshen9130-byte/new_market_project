/**
 * Saved 净值断档 / 净值异常 results for 平台数据.
 *
 * The list filters used to re-read every fund's NAV series on each click.
 * Flags are recomputed only when the latest NAV date, 运作日, or the rule
 * version no longer matches.
 */

import { query } from "@/lib/db"
import type { NavAnomalyHit } from "@/lib/server/nav-anomaly"
import {
  assessPlatformNavSeries,
  operationDateByFundId,
  type PlatformFundSeed,
} from "@/lib/server/team-data-query-pg"

// v5: prefer primary/least-gapped detail cache (SBDU00 over C2026); family gap dates include email+Type6.
export const NAV_SERIES_FLAG_RULE = "jump30_spike15_quiet5x8_gap10_v5"
const FLAG_TTL_MS = 10 * 60 * 1000
// Bump when the scorer changes so a running server drops flags cached under the old rule.
const FLAG_MEMORY_REV = 6
const OP_TTL_MS = 60 * 1000
const ASSESS_BATCH = 400
const ASSESS_CONCURRENCY = 4

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_nav_series_flags (
    beian_hao TEXT PRIMARY KEY,
    tip_date TEXT NOT NULL DEFAULT '',
    operation_date TEXT NOT NULL DEFAULT '',
    has_interior_gap BOOLEAN NOT NULL,
    anomaly JSONB,
    rule_version TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

type FlagSeed = PlatformFundSeed & { tipDate: string | null }

type StoredFlag = {
  tip: string
  op: string
  gap: boolean
  anomaly: NavAnomalyHit | null
  rule: string
  rev: number
  at: number
}

declare global {
  // eslint-disable-next-line no-var
  var _navSeriesFlagsReady: boolean | undefined
  // eslint-disable-next-line no-var
  var _navSeriesFlagMemory: Map<string, StoredFlag> | undefined
  // eslint-disable-next-line no-var
  var _navSeriesOpMemory: Map<string, { day: string; at: number }> | undefined
}

function flagMemory(): Map<string, StoredFlag> {
  if (!global._navSeriesFlagMemory) global._navSeriesFlagMemory = new Map()
  return global._navSeriesFlagMemory
}

function opMemory(): Map<string, { day: string; at: number }> {
  if (!global._navSeriesOpMemory) global._navSeriesOpMemory = new Map()
  return global._navSeriesOpMemory
}

let ensureOnce: Promise<void> | null = null

function ensureTable(): Promise<void> {
  if (global._navSeriesFlagsReady) return Promise.resolve()
  if (!ensureOnce) {
    ensureOnce = query(CREATE_SQL).then(() => {
      global._navSeriesFlagsReady = true
    }).catch((err) => {
      ensureOnce = null
      throw err
    })
  }
  return ensureOnce
}

function asAnomaly(value: unknown): NavAnomalyHit | null {
  if (value == null) return null
  let raw = value
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (raw == null || typeof raw !== "object") return null
  const rec = raw as NavAnomalyHit
  if (rec.reason !== "jump" && rec.reason !== "spike") return null
  if (!rec.date || !Number.isFinite(rec.ratio)) return null
  return rec
}

async function readStoredFlags(ids: string[]): Promise<Map<string, StoredFlag>> {
  const out = new Map<string, StoredFlag>()
  if (ids.length === 0) return out
  const memory = flagMemory()
  const now = Date.now()
  const missing: string[] = []
  for (const id of ids) {
    const hit = memory.get(id)
    if (hit && hit.rev === FLAG_MEMORY_REV && now - hit.at < FLAG_TTL_MS) out.set(id, hit)
    else missing.push(id)
  }
  if (missing.length === 0) return out
  const rows = await query<{
    beian_hao: string
    tip_date: string | null
    operation_date: string | null
    has_interior_gap: boolean
    anomaly: unknown
    rule_version: string | null
  }>(
    `SELECT beian_hao, tip_date, operation_date, has_interior_gap, anomaly, rule_version
     FROM ops_nav_series_flags
     WHERE beian_hao = ANY($1::text[])`,
    [missing],
  )
  for (const row of rows) {
    const stored: StoredFlag = {
      tip: row.tip_date ?? "",
      op: row.operation_date ?? "",
      gap: row.has_interior_gap === true,
      anomaly: asAnomaly(row.anomaly),
      rule: row.rule_version ?? "",
      rev: FLAG_MEMORY_REV,
      at: now,
    }
    memory.set(row.beian_hao, stored)
    out.set(row.beian_hao, stored)
  }
  return out
}

async function operationDatesFor(rows: FlagSeed[]): Promise<Map<string, string>> {
  const now = Date.now()
  const memory = opMemory()
  const known = new Map<string, string>()
  const missing: FlagSeed[] = []
  for (const row of rows) {
    const hit = memory.get(row.id)
    if (hit && now - hit.at < OP_TTL_MS) known.set(row.id, hit.day)
    else missing.push(row)
  }
  if (missing.length === 0) return known
  const loaded = await operationDateByFundId(missing)
  for (const row of missing) {
    const day = loaded.get(row.id) ?? ""
    memory.set(row.id, { day, at: now })
    known.set(row.id, day)
  }
  return known
}

async function assessInBatches(rows: FlagSeed[]): Promise<{
  gappedIds: Set<string>
  anomalyById: Map<string, NavAnomalyHit>
  operationDateById: Map<string, string>
}> {
  const gappedIds = new Set<string>()
  const anomalyById = new Map<string, NavAnomalyHit>()
  const operationDateById = new Map<string, string>()
  const batches: FlagSeed[][] = []
  for (let i = 0; i < rows.length; i += ASSESS_BATCH) batches.push(rows.slice(i, i + ASSESS_BATCH))
  let cursor = 0
  async function worker() {
    while (cursor < batches.length) {
      const index = cursor
      cursor += 1
      const part = await assessPlatformNavSeries(batches[index])
      for (const id of part.gappedIds) gappedIds.add(id)
      for (const [id, hit] of part.anomalyById) anomalyById.set(id, hit)
      for (const [id, day] of part.operationDateById) operationDateById.set(id, day)
    }
  }
  const workers = Math.min(ASSESS_CONCURRENCY, batches.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return { gappedIds, anomalyById, operationDateById }
}

async function upsertFlags(
  rows: FlagSeed[],
  assessed: {
    gappedIds: Set<string>
    anomalyById: Map<string, NavAnomalyHit>
    operationDateById: Map<string, string>
  },
  opById: Map<string, string>,
): Promise<void> {
  const now = Date.now()
  const memory = flagMemory()
  const chunk = 300
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const ids: string[] = []
    const tips: string[] = []
    const ops: string[] = []
    const gaps: boolean[] = []
    const anomalies: Array<string | null> = []
    const rules: string[] = []
    for (const row of slice) {
      const tip = row.tipDate ?? ""
      const op = assessed.operationDateById.get(row.id) ?? opById.get(row.id) ?? ""
      const anomaly = assessed.anomalyById.get(row.id) ?? null
      const gap = assessed.gappedIds.has(row.id)
      ids.push(row.id)
      tips.push(tip)
      ops.push(op)
      gaps.push(gap)
      anomalies.push(anomaly ? JSON.stringify(anomaly) : null)
      rules.push(NAV_SERIES_FLAG_RULE)
      memory.set(row.id, { tip, op, gap, anomaly, rule: NAV_SERIES_FLAG_RULE, rev: FLAG_MEMORY_REV, at: now })
    }
    await query(
      `INSERT INTO ops_nav_series_flags (
         beian_hao, tip_date, operation_date, has_interior_gap, anomaly, rule_version, computed_at
       )
       SELECT u.beian_hao, u.tip_date, u.operation_date, u.has_gap, u.anomaly::jsonb, u.rule_version, NOW()
       FROM unnest($1::text[], $2::text[], $3::text[], $4::bool[], $5::text[], $6::text[])
         AS u(beian_hao, tip_date, operation_date, has_gap, anomaly, rule_version)
       ON CONFLICT (beian_hao) DO UPDATE SET
         tip_date = EXCLUDED.tip_date,
         operation_date = EXCLUDED.operation_date,
         has_interior_gap = EXCLUDED.has_interior_gap,
         anomaly = EXCLUDED.anomaly,
         rule_version = EXCLUDED.rule_version,
         computed_at = NOW()`,
      [ids, tips, ops, gaps, anomalies, rules],
    )
  }
}

let writeChain: Promise<unknown> = Promise.resolve()

export async function loadFreshNavSeriesFlags(rows: FlagSeed[]): Promise<{
  gapped: Set<string>
  anomalyById: Map<string, NavAnomalyHit>
}> {
  await ensureTable()
  const run = writeChain.then(() => loadFreshNavSeriesFlagsInner(rows))
  writeChain = run.then(() => undefined, () => undefined)
  return run
}

async function loadFreshNavSeriesFlagsInner(rows: FlagSeed[]): Promise<{
  gapped: Set<string>
  anomalyById: Map<string, NavAnomalyHit>
}> {
  const gapped = new Set<string>()
  const anomalyById = new Map<string, NavAnomalyHit>()
  if (rows.length === 0) return { gapped, anomalyById }

  const [stored, opById] = await Promise.all([
    readStoredFlags(rows.map((row) => row.id)),
    operationDatesFor(rows),
  ])
  const stale: FlagSeed[] = []
  for (const row of rows) {
    const flag = stored.get(row.id)
    const tip = row.tipDate ?? ""
    const op = opById.get(row.id) ?? ""
    if (flag && flag.rule === NAV_SERIES_FLAG_RULE && flag.tip === tip && flag.op === op) {
      if (flag.gap) gapped.add(row.id)
      if (flag.anomaly) anomalyById.set(row.id, flag.anomaly)
    } else {
      stale.push(row)
    }
  }
  if (stale.length === 0) return { gapped, anomalyById }

  const assessed = await assessInBatches(stale)
  await upsertFlags(stale, assessed, opById)
  for (const row of stale) {
    if (assessed.gappedIds.has(row.id)) gapped.add(row.id)
    const hit = assessed.anomalyById.get(row.id)
    if (hit) anomalyById.set(row.id, hit)
  }
  return { gapped, anomalyById }
}
