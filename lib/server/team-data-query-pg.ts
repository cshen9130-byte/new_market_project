/**
 * Team data list — one row per fund discovered in ops_email_nav_records.
 * Share-class naming and deduplication mirror 投资 FOF底层.
 * Identity tables are loaded once per request; matching runs in memory.
 */

import { query } from "@/lib/db"
import { normalizeFundDisplayName } from "@/lib/server/email-nav-extract"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import { EMAIL_NAV_SOURCE_PRIORITY } from "@/lib/server/email-nav-query"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"
import { shareClassFromFundName } from "@/lib/server/fund-holding-code"

export type TeamDataListParams = {
  page: number
  pageSize: number
  keyword: string
  strategySource: "company" | "platform"
  strategyL1: string
  strategyL2: string
  strategyL3: string
  sort: string
  sortDir: "ASC" | "DESC"
}

export type TeamDataListRow = {
  id: string
  beian_hao: string | null
  product_name: string
  platform_nav: string | null
  platform_nav_date: string | null
  team_nav: string | null
  team_nav_date: string | null
  valuation_date: string | null
  product_source: string
  strategy_l1: string | null
}

type RawEmailFund = {
  fund_key: string
  product_code: string | null
  fund_name: string | null
  team_nav_date: string
  team_nav: string
}

type ResolvedFund = {
  id: string
  beian_hao: string | null
  product_name: string
  team_nav_date: string
  team_nav: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  product_source: string
}

type BflRow = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_company: string | null
}

type T6Row = {
  register_number: string
  fund_short_name: string | null
  company_strategy_one: string | null
  company_strategy_two: string | null
  company_strategy_three: string | null
  platform_strategy_one: string | null
  platform_strategy_two: string | null
  platform_strategy_three: string | null
}

type NamedFundRow = {
  beian_hao: string | null
  product_name: string
}

type IdentityTables = {
  bfl: BflRow[]
  t6: T6Row[]
  fofDetail: NamedFundRow[]
  fofTrack: NamedFundRow[]
}

type IdentityIndexes = {
  bflByBeian: Map<string, BflRow>
  t6ByRegister: Map<string, T6Row>
  bflByNameBase: Map<string, BflRow[]>
  t6ByNameBase: Map<string, T6Row[]>
  fofDetailByNameBase: Map<string, NamedFundRow[]>
  fofTrackByNameBase: Map<string, NamedFundRow[]>
}

const IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000
const EMAIL_FUNDS_CACHE_TTL_MS = 60 * 1000

let identityCache: { tables: IdentityTables; indexes: IdentityIndexes; at: number } | null = null
let emailFundsCache: { rows: RawEmailFund[]; at: number } | null = null

type ManualTeamDataProduct = {
  beian_hao: string
  product_name: string
}

export function invalidateTeamDataListCaches(): void {
  emailFundsCache = null
  identityCache = null
}

async function ensureTeamDataProductsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_data_products (
      id           SERIAL PRIMARY KEY,
      beian_hao    VARCHAR(64) NOT NULL,
      product_name VARCHAR(512) NOT NULL,
      created_by   VARCHAR(255) NOT NULL DEFAULT '',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao)
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ops_team_data_products_beian
      ON ops_team_data_products (beian_hao)
  `)
}

async function loadManualTeamDataProducts(): Promise<ManualTeamDataProduct[]> {
  await ensureTeamDataProductsTable()
  return query<ManualTeamDataProduct>(
    `SELECT beian_hao, product_name
     FROM ops_team_data_products
     ORDER BY created_at DESC, id DESC`,
  )
}

async function teamDataProductInEmailNav(beian_hao: string): Promise<boolean> {
  await ensureEmailNavTable()
  const rows = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM ops_email_nav_records e
     WHERE NULLIF(BTRIM(e.product_code), '') = $1
     LIMIT 1`,
    [beian_hao],
  )
  return rows.length > 0
}

export async function addTeamDataProduct(params: {
  beian_hao: string
  product_name: string
  created_by?: string
}): Promise<{ ok: true } | { error: "missing_fields" | "already_exists" }> {
  const beian_hao = params.beian_hao.trim()
  const product_name = params.product_name.trim()
  if (!beian_hao || !product_name) return { error: "missing_fields" }

  await ensureTeamDataProductsTable()

  const existingManual = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ops_team_data_products WHERE beian_hao = $1 LIMIT 1`,
    [beian_hao],
  )
  if (existingManual.length > 0) return { error: "already_exists" }

  if (await teamDataProductInEmailNav(beian_hao)) {
    return { error: "already_exists" }
  }

  await query(
    `INSERT INTO ops_team_data_products (beian_hao, product_name, created_by)
     VALUES ($1, $2, $3)`,
    [beian_hao, product_name, params.created_by?.trim() || ""],
  )
  invalidateTeamDataListCaches()
  return { ok: true }
}

export async function removeTeamDataProduct(params: {
  beian_hao: string
}): Promise<{ ok: true } | { error: "missing_fields" | "not_found" | "not_removable" }> {
  const beian_hao = params.beian_hao.trim()
  if (!beian_hao) return { error: "missing_fields" }

  await ensureTeamDataProductsTable()

  const existing = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ops_team_data_products WHERE beian_hao = $1 LIMIT 1`,
    [beian_hao],
  )
  if (existing.length === 0) {
    if (await teamDataProductInEmailNav(beian_hao)) {
      return { error: "not_removable" }
    }
    return { error: "not_found" }
  }

  await query(`DELETE FROM ops_team_data_products WHERE beian_hao = $1`, [beian_hao])
  invalidateTeamDataListCaches()
  return { ok: true }
}

function resolveManualProduct(
  manual: ManualTeamDataProduct,
  indexes: IdentityIndexes,
  strategySource: "company" | "platform",
): ResolvedFund {
  const bfl = indexes.bflByBeian.get(manual.beian_hao)
  const t6 = indexes.t6ByRegister.get(manual.beian_hao)
  const fromT6 = strategiesFromRow(t6 ?? null, strategySource)
  const fromBfl = strategiesFromRow(bfl ?? null, strategySource)
  const strategies = {
    l1: fromT6.l1 ?? fromBfl.l1,
    l2: fromT6.l2 ?? fromBfl.l2,
    l3: fromT6.l3 ?? fromBfl.l3,
  }

  return {
    id: manual.beian_hao,
    beian_hao: manual.beian_hao,
    product_name: displayProductName(
      bfl?.product_name ?? null,
      bfl?.short_name ?? t6?.fund_short_name ?? null,
      manual.product_name,
    ),
    team_nav_date: "",
    team_nav: "",
    strategy_l1: strategies.l1,
    strategy_l2: strategies.l2,
    strategy_l3: strategies.l3,
    product_source: "手动添加",
  }
}

function mergeManualTeamDataProducts(
  resolved: ResolvedFund[],
  manualProducts: ManualTeamDataProduct[],
  indexes: IdentityIndexes,
  strategySource: "company" | "platform",
): ResolvedFund[] {
  if (manualProducts.length === 0) return resolved
  const emailBeians = new Set(
    resolved.map((r) => r.beian_hao?.trim()).filter(Boolean) as string[],
  )
  const emailIds = new Set(resolved.map((r) => r.id))
  const extras: ResolvedFund[] = []
  for (const manual of manualProducts) {
    const beian = manual.beian_hao.trim()
    if (!beian || emailBeians.has(beian) || emailIds.has(beian)) continue
    extras.push(resolveManualProduct(manual, indexes, strategySource))
  }
  if (extras.length === 0) return resolved
  return dedupeResolvedByBeian([...resolved, ...extras])
}

const EMAIL_FUNDS_SORT: Record<string, string> = {
  product_name: "product_name",
  beian_hao: "beian_hao",
  team_nav: "team_nav",
  team_nav_date: "team_nav_date",
  platform_nav: "platform_nav",
  platform_nav_date: "platform_nav_date",
  valuation_date: "valuation_date",
}

function fundNameBase(name: string): string {
  return name
    .trim()
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)$/, "")
    .replace(/[ABC]类$/, "")
    .trim()
}

function serialSuffix(name: string): string {
  const m = fundNameBase(name).match(/[一二三四五六七八九十百千0-9]+号$/)
  return m?.[0] ?? ""
}

function pushNameIndex<T>(index: Map<string, T[]>, name: string, row: T) {
  const base = fundNameBase(name).toLowerCase()
  if (!base) return
  const bucket = index.get(base)
  if (bucket) bucket.push(row)
  else index.set(base, [row])
}

function buildIdentityIndexes(tables: IdentityTables): IdentityIndexes {
  const bflByBeian = new Map<string, BflRow>()
  const t6ByRegister = new Map<string, T6Row>()
  const bflByNameBase = new Map<string, BflRow[]>()
  const t6ByNameBase = new Map<string, T6Row[]>()
  const fofDetailByNameBase = new Map<string, NamedFundRow[]>()
  const fofTrackByNameBase = new Map<string, NamedFundRow[]>()

  for (const row of tables.bfl) {
    bflByBeian.set(row.beian_hao, row)
    pushNameIndex(bflByNameBase, row.product_name, row)
    if (row.short_name) pushNameIndex(bflByNameBase, row.short_name, row)
  }
  for (const row of tables.t6) {
    t6ByRegister.set(row.register_number, row)
    if (row.fund_short_name) pushNameIndex(t6ByNameBase, row.fund_short_name, row)
  }
  for (const row of tables.fofDetail) pushNameIndex(fofDetailByNameBase, row.product_name, row)
  for (const row of tables.fofTrack) pushNameIndex(fofTrackByNameBase, row.product_name, row)

  return { bflByBeian, t6ByRegister, bflByNameBase, t6ByNameBase, fofDetailByNameBase, fofTrackByNameBase }
}

function collectByNameBase<T>(index: Map<string, T[]>, candidate: string): T[] {
  const base = fundNameBase(candidate).toLowerCase()
  if (!base) return []
  const out: T[] = []
  const seen = new Set<T>()
  const add = (rows: T[] | undefined) => {
    for (const row of rows ?? []) {
      if (seen.has(row)) continue
      seen.add(row)
      out.push(row)
    }
  }
  add(index.get(base))
  for (const [key, rows] of index) {
    if (key === base) continue
    if (key.startsWith(base) || base.startsWith(key)) add(rows)
  }
  return out
}

function fundNamesMatch(column: string, target: string): boolean {
  const col = column.trim()
  const tgt = target.trim()
  if (!col || !tgt) return false
  const guard = serialSuffix(col) === serialSuffix(tgt)
  const colBase = fundNameBase(col)
  const tgtBase = fundNameBase(tgt)
  if (col === tgt) return true
  if (col.startsWith(tgt) && guard) return true
  if (tgt.startsWith(col) && guard) return true
  if (colBase && tgtBase) {
    if (colBase === tgtBase) return true
    if (colBase.startsWith(tgtBase) && guard) return true
    if (tgtBase.startsWith(colBase) && guard) return true
  }
  return false
}

function matchPriority(column: string, target: string): number {
  const col = column.trim()
  const tgt = target.trim()
  if (col === tgt) return 0
  if (col.startsWith(tgt)) return 1
  if (tgt.startsWith(col)) return 2
  return 3
}

function shareClassCodeGuard(code: string | null | undefined, productName: string): boolean {
  const cls = shareClassFromFundName(productName)
  if (!cls) return true
  const c = (code ?? "").trim().toUpperCase()
  if (!c) return true
  return c.endsWith(cls)
}

function cleanEmailFundName(raw: string | null): string | null {
  if (!raw?.trim()) return null
  const stripped = raw.trim().replace(/^资产净值公告_[A-Z0-9]+_/, "")
  return normalizeFundDisplayName(stripped)
}

function nameCandidate(row: RawEmailFund): string {
  const fromName = row.fund_name && !row.fund_name.startsWith("资产净值公告_")
    ? normalizeFundDisplayName(row.fund_name)
    : cleanEmailFundName(row.fund_name)
  return fromName ?? row.product_code ?? row.fund_key
}

function codeMatchesShareClass(code: string, name: string): boolean {
  return shareClassCodeGuard(code, name)
}

function dedupeKey(row: RawEmailFund): string {
  const candidate = nameCandidate(row)
  if (row.product_code && codeMatchesShareClass(row.product_code, candidate)) {
    return row.product_code.trim().toUpperCase()
  }
  const cls = shareClassFromFundName(candidate)
  return `${fundNameBase(candidate).toLowerCase()}${cls}`
}

function displayProductName(
  lookupName: string | null | undefined,
  lookupShort: string | null | undefined,
  candidate: string,
): string {
  const canonical = lookupName?.trim() || candidate
  if (/[ABC]类/u.test(canonical)) return canonical
  return lookupShort?.trim() || canonical
}

function bestNamedMatchFromRows(rows: NamedFundRow[], candidate: string): NamedFundRow | null {
  let best: NamedFundRow | null = null
  let bestScore = Infinity
  for (const row of rows) {
    if (!fundNamesMatch(row.product_name, candidate)) continue
    if (!shareClassCodeGuard(row.beian_hao, candidate)) continue
    const score = matchPriority(row.product_name, candidate)
    if (score < bestScore) {
      bestScore = score
      best = row
    }
  }
  return best
}

function bestNamedMatch(
  index: Map<string, NamedFundRow[]>,
  candidate: string,
): NamedFundRow | null {
  return bestNamedMatchFromRows(collectByNameBase(index, candidate), candidate)
}

function bestBflMatch(
  indexes: IdentityIndexes,
  candidate: string,
  productCode: string | null,
): BflRow | null {
  if (productCode) {
    const byCode = indexes.bflByBeian.get(productCode)
    if (byCode && shareClassCodeGuard(byCode.beian_hao, candidate)) return byCode
  }
  let best: BflRow | null = null
  let bestScore = Infinity
  for (const row of collectByNameBase(indexes.bflByNameBase, candidate)) {
    const names = [row.product_name, row.short_name].filter(Boolean) as string[]
    if (!names.some((n) => fundNamesMatch(n, candidate))) continue
    if (!shareClassCodeGuard(row.beian_hao, candidate)) continue
    const score = Math.min(...names.map((n) => matchPriority(n, candidate)))
    if (score < bestScore) {
      bestScore = score
      best = row
    }
  }
  return best
}

function bestT6Match(
  indexes: IdentityIndexes,
  candidate: string,
  productCode: string | null,
): T6Row | null {
  if (productCode) {
    const byCode = indexes.t6ByRegister.get(productCode)
    if (byCode && shareClassCodeGuard(byCode.register_number, candidate)) return byCode
  }
  let best: T6Row | null = null
  let bestScore = Infinity
  for (const row of collectByNameBase(indexes.t6ByNameBase, candidate)) {
    const name = row.fund_short_name?.trim()
    if (!name || !fundNamesMatch(name, candidate)) continue
    if (!shareClassCodeGuard(row.register_number, candidate)) continue
    const score = matchPriority(name, candidate)
    if (score < bestScore) {
      bestScore = score
      best = row
    }
  }
  return best
}

function strategiesFromRow(
  row: T6Row | BflRow | null,
  strategySource: "company" | "platform",
): { l1: string | null; l2: string | null; l3: string | null } {
  if (!row) return { l1: null, l2: null, l3: null }
  if ("register_number" in row) {
    if (strategySource === "platform") {
      return {
        l1: row.platform_strategy_one?.trim() || null,
        l2: row.platform_strategy_two?.trim() || null,
        l3: row.platform_strategy_three?.trim() || null,
      }
    }
    return {
      l1: row.company_strategy_one?.trim() || null,
      l2: row.company_strategy_two?.trim() || null,
      l3: row.company_strategy_three?.trim() || null,
    }
  }
  const company = row.strategy_company?.trim()
  if (!company) return { l1: null, l2: null, l3: null }
  return { l1: company.split(/[,，]/)[0]?.trim() || null, l2: null, l3: null }
}

function matchesStrategyL3(stored: string | null, filter: string): boolean {
  if (!filter) return true
  if (!stored) return false
  return stored.toLowerCase().includes(filter.toLowerCase())
}

async function loadRawEmailFunds(): Promise<RawEmailFund[]> {
  if (emailFundsCache && Date.now() - emailFundsCache.at < EMAIL_FUNDS_CACHE_TTL_MS) {
    return emailFundsCache.rows
  }
  await ensureEmailNavTable()
  const rows = await query<RawEmailFund>(
    `WITH email_ranked AS (
       SELECT
         e.id,
         NULLIF(BTRIM(e.product_code), '') AS product_code,
         NULLIF(BTRIM(e.fund_name), '') AS fund_name,
         e.nav_date,
         e.nav,
         e.source,
         COALESCE(
           NULLIF(BTRIM(e.product_code), ''),
           NULLIF(BTRIM(e.fund_name), '')
         ) AS fund_key
       FROM ops_email_nav_records e
       WHERE e.nav IS NOT NULL AND e.nav_date IS NOT NULL
     )
     SELECT DISTINCT ON (fund_key)
       fund_key,
       product_code,
       fund_name,
       nav_date::text AS team_nav_date,
       nav::text AS team_nav
     FROM email_ranked
     ORDER BY
       fund_key,
       ${EMAIL_NAV_SOURCE_PRIORITY.replace(/\be\./g, "")},
       CASE WHEN COALESCE(fund_name, '') NOT LIKE '资产净值公告_%' THEN 0 ELSE 1 END,
       nav_date DESC,
       id DESC`,
  )
  emailFundsCache = { rows, at: Date.now() }
  return rows
}

function dedupeRawFunds(rows: RawEmailFund[]): RawEmailFund[] {
  const byKey = new Map<string, RawEmailFund>()
  for (const row of rows) {
    const key = dedupeKey(row)
    const prev = byKey.get(key)
    if (!prev || row.team_nav_date.localeCompare(prev.team_nav_date) > 0) {
      byKey.set(key, row)
    } else if (row.team_nav_date === prev.team_nav_date && row.product_code && !prev.product_code) {
      byKey.set(key, row)
    }
  }
  return Array.from(byKey.values())
}

function dedupeResolvedByBeian(rows: ResolvedFund[]): ResolvedFund[] {
  const byBeian = new Map<string, ResolvedFund>()
  const noBeian: ResolvedFund[] = []
  for (const row of rows) {
    if (!row.beian_hao?.trim()) {
      noBeian.push(row)
      continue
    }
    const key = row.beian_hao.trim()
    const prev = byBeian.get(key)
    if (!prev || row.team_nav_date.localeCompare(prev.team_nav_date) > 0) {
      byBeian.set(key, row)
    }
  }
  return [...byBeian.values(), ...noBeian]
}

async function loadIdentityTables(): Promise<{ tables: IdentityTables; indexes: IdentityIndexes }> {
  if (identityCache && Date.now() - identityCache.at < IDENTITY_CACHE_TTL_MS) {
    return { tables: identityCache.tables, indexes: identityCache.indexes }
  }
  const [bfl, t6, fofDetail, fofTrack] = await Promise.all([
    query<BflRow>(
      `SELECT beian_hao, product_name, short_name, strategy_company
       FROM private_fund_info_bfl
       WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL`,
    ),
    query<T6Row>(
      `SELECT register_number, fund_short_name,
              company_strategy_one, company_strategy_two, company_strategy_three,
              platform_strategy_one, platform_strategy_two, platform_strategy_three
       FROM type6_ops_team_full
       WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL`,
    ),
    query<NamedFundRow>(
      `SELECT beian_hao, product_name FROM fof_underlying_detail
       WHERE NULLIF(BTRIM(product_name), '') IS NOT NULL`,
    ),
    query<NamedFundRow>(
      `SELECT beian_hao, product_name FROM investment_tracking_fof_underlying
       WHERE NULLIF(BTRIM(product_name), '') IS NOT NULL`,
    ),
  ])
  const tables = { bfl, t6, fofDetail, fofTrack }
  const indexes = buildIdentityIndexes(tables)
  identityCache = { tables, indexes, at: Date.now() }
  return { tables, indexes }
}

function resolveFund(
  row: RawEmailFund,
  indexes: IdentityIndexes,
  strategySource: "company" | "platform",
): ResolvedFund {
  const candidate = nameCandidate(row)
  const fd = bestNamedMatch(indexes.fofDetailByNameBase, candidate)
  const track = bestNamedMatch(indexes.fofTrackByNameBase, candidate)
  const bfl = bestBflMatch(indexes, candidate, row.product_code)
  const t6 = bestT6Match(indexes, candidate, row.product_code)

  const beian_hao = (() => {
    if (row.product_code && codeMatchesShareClass(row.product_code, candidate)) {
      return row.product_code.trim()
    }
    return bfl?.beian_hao ?? t6?.register_number ?? fd?.beian_hao ?? track?.beian_hao ?? row.product_code ?? null
  })()

  const product_name = displayProductName(
    fd?.product_name ?? track?.product_name ?? bfl?.product_name,
    bfl?.short_name ?? t6?.fund_short_name,
    candidate,
  )

  const fromT6 = strategiesFromRow(t6, strategySource)
  const fromBfl = strategiesFromRow(bfl, strategySource)
  const strategies = {
    l1: fromT6.l1 ?? fromBfl.l1,
    l2: fromT6.l2 ?? fromBfl.l2,
    l3: fromT6.l3 ?? fromBfl.l3,
  }

  return {
    id: beian_hao ?? dedupeKey(row),
    beian_hao,
    product_name,
    team_nav_date: row.team_nav_date,
    team_nav: row.team_nav,
    strategy_l1: strategies.l1,
    strategy_l2: strategies.l2,
    strategy_l3: strategies.l3,
    product_source: "邮箱同步",
  }
}

async function enrichPageRows(rows: ResolvedFund[]): Promise<TeamDataListRow[]> {
  if (rows.length === 0) return []
  try {
    await ensureEmailValuationMetricsTables()
  } catch {
    // optional
  }

  const beians = rows.map((r) => r.beian_hao).filter(Boolean) as string[]
  const [platRows, vmRows] = await Promise.all([
    beians.length > 0
      ? query<{ beian_hao: string; nav: string; price_date: string }>(
          `SELECT DISTINCT ON (beian_hao)
             beian_hao, nav::text, price_date::text
           FROM private_fund_nav_group_type6
           WHERE beian_hao = ANY($1::text[]) AND price_date <= CURRENT_DATE
           ORDER BY beian_hao, price_date DESC`,
          [beians],
        )
      : Promise.resolve([]),
    beians.length > 0
      ? query<{ product_code: string; valuation_date: string }>(
          `SELECT product_code, valuation_date::text
           FROM ops_email_valuation_fund_metrics_latest
           WHERE product_code = ANY($1::text[])`,
          [beians],
        )
      : Promise.resolve([]),
  ])

  const platByBeian = new Map(platRows.map((r) => [r.beian_hao, r]))
  const vmByCode = new Map(vmRows.map((r) => [r.product_code, r.valuation_date]))

  return rows.map((row) => {
    const plat = row.beian_hao ? platByBeian.get(row.beian_hao) : undefined
    return {
      id: row.id,
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      platform_nav: plat?.nav ?? null,
      platform_nav_date: plat?.price_date ?? null,
      team_nav: row.team_nav,
      team_nav_date: row.team_nav_date,
      valuation_date: row.beian_hao ? (vmByCode.get(row.beian_hao) ?? null) : null,
      product_source: row.product_source,
      strategy_l1: row.strategy_l1,
    }
  })
}

function compareRows(a: TeamDataListRow, b: TeamDataListRow, sort: string, dir: "ASC" | "DESC"): number {
  const col = EMAIL_FUNDS_SORT[sort] ?? "team_nav_date"
  const av = a[col as keyof TeamDataListRow]
  const bv = b[col as keyof TeamDataListRow]
  const mul = dir === "ASC" ? 1 : -1

  if (col === "team_nav" || col === "platform_nav") {
    const an = av == null ? null : parseFloat(String(av))
    const bn = bv == null ? null : parseFloat(String(bv))
    if (an == null && bn == null) return a.product_name.localeCompare(b.product_name, "zh")
    if (an == null) return 1
    if (bn == null) return -1
    return (an - bn) * mul || a.product_name.localeCompare(b.product_name, "zh")
  }

  const as = av == null ? "" : String(av)
  const bs = bv == null ? "" : String(bv)
  if (!as && !bs) return a.product_name.localeCompare(b.product_name, "zh")
  if (!as) return 1
  if (!bs) return -1
  return as.localeCompare(bs, "zh") * mul || a.product_name.localeCompare(b.product_name, "zh")
}

export async function listTeamData(params: TeamDataListParams): Promise<{
  data: TeamDataListRow[]
  total: number
}> {
  const { page, pageSize, keyword, strategySource, strategyL1, strategyL2, strategyL3, sort, sortDir } = params

  const [rawRows, manualProducts, { indexes }] = await Promise.all([
    loadRawEmailFunds().then(dedupeRawFunds),
    loadManualTeamDataProducts(),
    loadIdentityTables(),
  ])

  let resolved = dedupeResolvedByBeian(rawRows.map((row) => resolveFund(row, indexes, strategySource)))
  resolved = mergeManualTeamDataProducts(resolved, manualProducts, indexes, strategySource)

  if (keyword) {
    const kw = keyword.toLowerCase()
    resolved = resolved.filter(
      (r) =>
        r.product_name.toLowerCase().includes(kw)
        || (r.beian_hao ?? "").toLowerCase().includes(kw)
        || r.id.toLowerCase().includes(kw),
    )
  }
  if (strategyL1 === "__unconfigured__") {
    resolved = resolved.filter((r) => !r.strategy_l1)
  } else if (strategyL1) {
    resolved = resolved.filter((r) => r.strategy_l1 === strategyL1)
  }
  if (strategyL2) {
    resolved = resolved.filter((r) => r.strategy_l2 === strategyL2)
  }
  if (strategyL3) {
    resolved = resolved.filter((r) => matchesStrategyL3(r.strategy_l3, strategyL3))
  }

  const sorted = [...resolved].sort((a, b) =>
    compareRows(
      { ...a, platform_nav: null, platform_nav_date: null, valuation_date: null },
      { ...b, platform_nav: null, platform_nav_date: null, valuation_date: null },
      sort,
      sortDir,
    ),
  )

  const total = sorted.length
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize)
  let data = await enrichPageRows(pageRows)

  if (sort === "platform_nav" || sort === "platform_nav_date" || sort === "valuation_date") {
    data = [...data].sort((a, b) => compareRows(a, b, sort, sortDir))
  }

  return { data, total }
}
