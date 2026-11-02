/**
 * Saved 净值断档 / 净值异常 results for 平台数据 and 团队数据.
 *
 * The list filters used to re-read every fund's NAV series on each click.
 * Flags are recomputed only when the latest NAV date, 运作日, or the rule
 * version no longer matches. The team list reads a saved flag immediately and
 * only waits on funds that have never been scored (or a small stale batch).
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
const FLAG_MEMORY_REV = 7
const OP_TTL_MS = 60 * 1000
const ASSESS_BATCH = 400
const ASSESS_CONCURRENCY = 4
/** Recompute this many stale funds before answering. A larger batch refreshes after the list returns. */
const STALE_INLINE_LIMIT = 40

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
let backgroundRefresh: Promise<unknown> | null = null

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

async function platformNavTips(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const rows = await query<{ beian_hao: string | null; tip: string | null }>(
    `SELECT BTRIM(beian_hao) AS beian_hao,
            LEFT(COALESCE(latest_nav_date::text, ''), 10) AS tip
     FROM private_fund_info
     WHERE BTRIM(beian_hao) = ANY($1::text[])`,
    [ids],
  ).catch(() => [] as Array<{ beian_hao: string | null; tip: string | null }>)
  for (const row of rows) {
    const id = row.beian_hao?.trim()
    if (!id || out.has(id)) continue
    out.set(id, (row.tip ?? "").slice(0, 10))
  }
  return out
}

function withPlatformTips(rows: FlagSeed[], tips: Map<string, string>): FlagSeed[] {
  return rows.map((row) => (
    tips.has(row.id) ? { ...row, tipDate: tips.get(row.id) ?? "" } : row
  ))
}

/**
 * Flags for a list click. Saved rows come back without re-reading NAV series.
 * Funds with no flag, and up to STALE_INLINE_LIMIT stale funds, are scored
 * before the response. A larger stale set is refreshed after the list returns,
 * using the same latest-NAV tip as 平台数据 so the two lists do not overwrite
 * each other.
 */
export async function loadStoredOrFreshNavSeriesFlags(rows: FlagSeed[]): Promise<{
  gapped: Set<string>
  anomalyById: Map<string, NavAnomalyHit>
}> {
  await ensureTable()
  const gapped = new Set<string>()
  const anomalyById = new Map<string, NavAnomalyHit>()
  if (rows.length === 0) return { gapped, anomalyById }

  const [stored, opById, tips] = await Promise.all([
    readStoredFlags(rows.map((row) => row.id)),
    operationDatesFor(rows),
    platformNavTips(rows.map((row) => row.id)),
  ])
  const missing: FlagSeed[] = []
  const stale: FlagSeed[] = []
  for (const row of withPlatformTips(rows, tips)) {
    const flag = stored.get(row.id)
    const tip = row.tipDate ?? ""
    const op = opById.get(row.id) ?? ""
    if (!flag || flag.rule !== NAV_SERIES_FLAG_RULE) {
      missing.push(row)
      continue
    }
    if (flag.gap) gapped.add(row.id)
    if (flag.anomaly) anomalyById.set(row.id, flag.anomaly)
    if (flag.tip !== tip || flag.op !== op) stale.push(row)
  }

  const inlineStale = stale.length <= STALE_INLINE_LIMIT ? stale : []
  const inline = [...missing, ...inlineStale]
  if (inline.length > 0) {
    const fresh = await loadFreshNavSeriesFlags(inline)
    for (const row of inline) {
      gapped.delete(row.id)
      anomalyById.delete(row.id)
      if (fresh.gapped.has(row.id)) gapped.add(row.id)
      const hit = fresh.anomalyById.get(row.id)
      if (hit) anomalyById.set(row.id, hit)
    }
  }
  if (stale.length > STALE_INLINE_LIMIT && !backgroundRefresh) {
    // Not on writeChain: a full rescore must not block the next list click.
    backgroundRefresh = loadFreshNavSeriesFlagsInner(stale).catch((err) => {
      console.error("[nav-series-flags] background refresh failed:", err)
    }).finally(() => {
      backgroundRefresh = null
    })
  }
  return { gapped, anomalyById }
}
