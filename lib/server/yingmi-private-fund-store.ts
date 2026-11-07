import { publicQuery, publicWithClient } from "@/lib/db"
import {
  emptyProgress,
  yingmiNote,
  type YingmiNodeProgress,
  type YingmiProduct,
  type YingmiStrategyRef,
  type YingmiTreeNode,
} from "@/lib/ma/yingmi-private-fund"
import seedFile from "../../data/yingmi-private-funds/catalog-2026-11-07.json"

const LOCK_KEY = 867530911

export type YingmiSyncState = {
  runStartedOn: string | null
  finishedOn: string | null
  callsDay: string | null
  callsToday: number
  strategies: YingmiStrategyRef[]
  progress: Record<string, YingmiNodeProgress>
  tree: YingmiTreeNode[] | null
}

export type YingmiSyncRow = {
  status: string
  lastError: string | null
  updatedAt: string | null
  state: YingmiSyncState
}

type DbProduct = {
  fund_code: string
  fund_name: string
  company_name: string
  strategy_level1: string
  strategy_level2: string | null
  strategy_level3: string | null
  setup_date: string | null
  nav_date: string | null
  nav_unit: string | number | null
  return_1y: string | number | null
  max_drawdown_1y: string | number | null
  performance_hide_reason: string | null
}

let schemaReady: Promise<void> | null = null

export function ensureYingmiSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createYingmiSchema().catch((err) => {
      schemaReady = null
      throw err
    })
  }
  return schemaReady
}

async function createYingmiSchema(): Promise<void> {
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS yingmi_private_fund (
      fund_code text PRIMARY KEY,
      fund_name text NOT NULL,
      company_name text NOT NULL DEFAULT '',
      strategy_level1 text NOT NULL DEFAULT '',
      strategy_level2 text,
      strategy_level3 text,
      setup_date date,
      nav_date date,
      nav_unit numeric,
      return_1y numeric,
      max_drawdown_1y numeric,
      performance_hide_reason text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS yingmi_mcp_credential (
      id int PRIMARY KEY CHECK (id = 1),
      client_id text NOT NULL,
      refresh_token text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS yingmi_mcp_oauth_pending (
      state text PRIMARY KEY,
      client_id text NOT NULL,
      code_verifier text NOT NULL,
      redirect_uri text NOT NULL,
      expires_at timestamptz NOT NULL
    )
  `)
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS yingmi_private_fund_sync (
      id int PRIMARY KEY CHECK (id = 1),
      status text NOT NULL DEFAULT 'idle',
      state jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

function envYingmiCredential(): { clientId: string; refreshToken: string } | null {
  const clientId = process.env.YINGMI_OAUTH_CLIENT_ID?.trim() || ""
  const refreshToken = process.env.YINGMI_OAUTH_REFRESH_TOKEN?.trim() || ""
  if (!clientId || !refreshToken) return null
  return { clientId, refreshToken }
}

export async function hasYingmiCredential(): Promise<boolean> {
  if (envYingmiCredential()) return true
  await ensureYingmiSchema()
  const res = await publicQuery(`SELECT 1 FROM yingmi_mcp_credential WHERE id = 1`)
  return (res.rowCount ?? 0) > 0
}

export async function saveYingmiCredential(clientId: string, refreshToken: string): Promise<void> {
  await ensureYingmiSchema()
  await publicQuery(
    `INSERT INTO yingmi_mcp_credential (id, client_id, refresh_token, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, refresh_token = EXCLUDED.refresh_token, updated_at = now()`,
    [clientId, refreshToken],
  )
}

export async function readYingmiCredential(): Promise<{ clientId: string; refreshToken: string } | null> {
  await ensureYingmiSchema()
  const res = await publicQuery<{ client_id: string; refresh_token: string }>(
    `SELECT client_id, refresh_token FROM yingmi_mcp_credential WHERE id = 1`,
  )
  const row = res.rows[0]
  if (row) return { clientId: row.client_id, refreshToken: row.refresh_token }
  return envYingmiCredential()
}

export async function saveOauthPending(input: {
  state: string
  clientId: string
  codeVerifier: string
  redirectUri: string
}): Promise<void> {
  await ensureYingmiSchema()
  await publicQuery(`DELETE FROM yingmi_mcp_oauth_pending WHERE expires_at < now()`)
  await publicQuery(
    `INSERT INTO yingmi_mcp_oauth_pending (state, client_id, code_verifier, redirect_uri, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
    [input.state, input.clientId, input.codeVerifier, input.redirectUri],
  )
}

export async function takeOauthPending(state: string): Promise<{
  clientId: string
  codeVerifier: string
  redirectUri: string
} | null> {
  await ensureYingmiSchema()
  const res = await publicQuery<{ client_id: string; code_verifier: string; redirect_uri: string }>(
    `DELETE FROM yingmi_mcp_oauth_pending WHERE state = $1 AND expires_at >= now() RETURNING client_id, code_verifier, redirect_uri`,
    [state],
  )
  const row = res.rows[0]
  if (!row) return null
  return { clientId: row.client_id, codeVerifier: row.code_verifier, redirectUri: row.redirect_uri }
}

function blankState(): YingmiSyncState {
  return {
    runStartedOn: null,
    finishedOn: null,
    callsDay: null,
    callsToday: 0,
    strategies: [],
    progress: {},
    tree: null,
  }
}

function parseState(value: unknown): YingmiSyncState {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<YingmiSyncState>
  return {
    runStartedOn: raw.runStartedOn ?? null,
    finishedOn: raw.finishedOn ?? null,
    callsDay: raw.callsDay ?? null,
    callsToday: Number(raw.callsToday) || 0,
    strategies: Array.isArray(raw.strategies) ? raw.strategies : [],
    progress: raw.progress && typeof raw.progress === "object" ? raw.progress : {},
    tree: Array.isArray(raw.tree) ? raw.tree : null,
  }
}

export async function readYingmiSync(): Promise<YingmiSyncRow> {
  await ensureYingmiSchema()
  const res = await publicQuery<{ status: string; state: unknown; last_error: string | null; updated_at: string | null }>(
    `SELECT status, state, last_error, updated_at FROM yingmi_private_fund_sync WHERE id = 1`,
  )
  const row = res.rows[0]
  if (!row) return { status: "idle", lastError: null, updatedAt: null, state: blankState() }
  return {
    status: row.status,
    lastError: row.last_error,
    updatedAt: row.updated_at,
    state: parseState(row.state),
  }
}

export async function writeYingmiSync(status: string, state: YingmiSyncState, lastError: string | null): Promise<void> {
  await ensureYingmiSchema()
  await publicQuery(
    `INSERT INTO yingmi_private_fund_sync (id, status, state, last_error, updated_at)
     VALUES (1, $1, $2::jsonb, $3, now())
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, state = EXCLUDED.state, last_error = EXCLUDED.last_error, updated_at = now()`,
    [status, JSON.stringify(state), lastError],
  )
}

export async function withYingmiLock<T>(fn: () => Promise<T>): Promise<T | { skipped: "busy" }> {
  return publicWithClient(async (client) => {
    const locked = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1::bigint) AS ok`, [LOCK_KEY])
    if (!locked.rows[0]?.ok) return { skipped: "busy" as const }
    try {
      return await fn()
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [LOCK_KEY])
    }
  }, { statementTimeoutMs: 0 })
}

function num(value: string | number | null): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function toProduct(row: DbProduct): YingmiProduct {
  return {
    fundCode: row.fund_code,
    fundName: row.fund_name,
    companyName: row.company_name,
    strategyLevel1: row.strategy_level1,
    strategyLevel2: row.strategy_level2,
    strategyLevel3: row.strategy_level3,
    setupDate: row.setup_date,
    navDate: row.nav_date,
    navUnit: num(row.nav_unit),
    return1y: num(row.return_1y),
    maxDrawdown1y: num(row.max_drawdown_1y),
    performanceHideReason: row.performance_hide_reason,
    note: yingmiNote(row.performance_hide_reason),
  }
}

export async function listYingmiProducts(): Promise<YingmiProduct[]> {
  await ensureYingmiSchema()
  const res = await publicQuery<DbProduct>(
    `SELECT fund_code, fund_name, company_name, strategy_level1, strategy_level2, strategy_level3,
            setup_date::text, nav_date::text, nav_unit, return_1y, max_drawdown_1y, performance_hide_reason
     FROM yingmi_private_fund
     ORDER BY strategy_level1, setup_date DESC NULLS LAST, fund_name`,
  )
  return res.rows.map(toProduct)
}

export function seedYingmiProducts(): YingmiProduct[] {
  return seedFile.products.map((row) => ({
    fundCode: row.fundCode,
    fundName: row.fundName,
    companyName: row.companyName,
    strategyLevel1: row.strategyLevel1,
    strategyLevel2: row.strategyLevel2,
    strategyLevel3: row.strategyLevel3,
    setupDate: row.setupDate,
    navDate: row.navDate,
    navUnit: row.navUnit,
    return1y: row.return1y,
    maxDrawdown1y: row.maxDrawdown1y,
    performanceHideReason: row.performanceHideReason,
    note: row.note || yingmiNote(row.performanceHideReason),
  }))
}

export const YINGMI_SEED_META = {
  asOf: seedFile.asOf,
  treeTotal: seedFile.treeTotal,
  listed: seedFile.listed,
  missing: seedFile.missing,
}

export async function countYingmiStrategy(strategy: YingmiStrategyRef): Promise<number> {
  await ensureYingmiSchema()
  const res = await publicQuery<{ n: string }>(
    `SELECT count(*)::text AS n FROM yingmi_private_fund
     WHERE strategy_level1 = $1
       AND ($2::text IS NULL OR strategy_level2 = $2)
       AND ($3::text IS NULL OR strategy_level3 = $3)`,
    [
      strategy.level <= 1 ? strategy.name : strategy.level1Name || "",
      strategy.level >= 2 ? (strategy.level === 2 ? strategy.name : strategy.level2Name || "") : null,
      strategy.level >= 3 ? strategy.name : null,
    ],
  )
  return Number(res.rows[0]?.n || 0)
}

export async function companyNamesForStrategy(strategy: YingmiStrategyRef, limit = 20): Promise<string[]> {
  await ensureYingmiSchema()
  const res = await publicQuery<{ company_name: string }>(
    `SELECT company_name FROM yingmi_private_fund
     WHERE strategy_level1 = $1
       AND ($2::text IS NULL OR strategy_level2 = $2)
       AND ($3::text IS NULL OR strategy_level3 = $3)
       AND company_name <> ''
     GROUP BY company_name
     ORDER BY max(setup_date) DESC NULLS LAST
     LIMIT $4`,
    [
      strategy.level <= 1 ? strategy.name : strategy.level1Name || "",
      strategy.level >= 2 ? (strategy.level === 2 ? strategy.name : strategy.level2Name || "") : null,
      strategy.level >= 3 ? strategy.name : null,
      limit,
    ],
  )
  return res.rows.map((row) => row.company_name)
}

export type YingmiIncomingFund = {
  fundCode: string
  fundName: string
  companyName?: string | null
  strategyLevel1?: string | null
  strategyLevel2?: string | null
  strategyLevel3?: string | null
  setupDate?: string | null
  navDate?: string | null
  navUnit?: number | null
  return1y?: number | null
  maxDrawdown1y?: number | null
  performanceHideReason?: string | null
}

export async function upsertYingmiFunds(items: YingmiIncomingFund[]): Promise<number> {
  await ensureYingmiSchema()
  let written = 0
  for (const item of items) {
    if (!item.fundCode || !item.fundName) continue
    await publicQuery(
      `INSERT INTO yingmi_private_fund (
         fund_code, fund_name, company_name, strategy_level1, strategy_level2, strategy_level3,
         setup_date, nav_date, nav_unit, return_1y, max_drawdown_1y, performance_hide_reason, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (fund_code) DO UPDATE SET
         fund_name = EXCLUDED.fund_name,
         company_name = EXCLUDED.company_name,
         strategy_level1 = EXCLUDED.strategy_level1,
         strategy_level2 = EXCLUDED.strategy_level2,
         strategy_level3 = EXCLUDED.strategy_level3,
         setup_date = EXCLUDED.setup_date,
         nav_date = EXCLUDED.nav_date,
         nav_unit = EXCLUDED.nav_unit,
         return_1y = EXCLUDED.return_1y,
         max_drawdown_1y = EXCLUDED.max_drawdown_1y,
         performance_hide_reason = EXCLUDED.performance_hide_reason,
         updated_at = now()`,
      [
        item.fundCode,
        item.fundName,
        item.companyName || "",
        item.strategyLevel1 || "",
        item.strategyLevel2 || null,
        item.strategyLevel3 || null,
        item.setupDate || null,
        item.navDate || null,
        item.navUnit ?? null,
        item.return1y ?? null,
        item.maxDrawdown1y ?? null,
        item.performanceHideReason || null,
      ],
    )
    written += 1
  }
  return written
}

export function progressOrEmpty(progress: Record<string, YingmiNodeProgress>, key: string): YingmiNodeProgress {
  return progress[key] || emptyProgress()
}
