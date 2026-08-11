/**
 * Team data list — one row per fund discovered in ops_email_nav_records.
 * Share-class naming and deduplication mirror 投资 FOF底层.
 * Identity tables are loaded once per request; matching runs in memory.
 */

import { query } from "@/lib/db"
import { extractNavMetadata, normalizeFundDisplayName } from "@/lib/server/email-nav-extract"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"
import { getAllEmailParseRecords } from "@/lib/server/email-parse-records"
import {
  EMAIL_NAV_SOURCE_PRIORITY,
  sqlPostInvestmentVirtualNavExpr,
} from "@/lib/server/email-nav-query"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"
import { shareClassFromFundName } from "@/lib/server/fund-holding-code"
import { shareClassProductCodesMatch, sqlFundNameMatch } from "@/lib/server/fund-name-match"
import { resolveManagedProductBeian } from "@/lib/server/managed-product-beian"
import { loadManualTeamNavBatch } from "@/lib/server/team-nav-manage-pg"

/**
 * Explicit 备案号 for team-data rows when email product_code is missing on some
 * messages (name-only rows) but the fund identity is known.
 * Share-class codes follow platform convention (no leading S): BQG14B not SBQG14B.
 */
const TEAM_DATA_BEIAN_OVERRIDES: Readonly<Record<string, string>> = {
  峰云汇高地一号B类: "BQG14B",
  青钱基石1号B类: "BDW42B",
  准星量化对冲三号A类: "AJU79A",
  // Occasional OCR / reading mix-up with 准星
  淮星量化对冲三号A类: "AJU79A",
  众量资产万里阳光1号: "SLP301",
  铸锋太阿3号A类: "SB969A",
  // C2026 was a false extract (letter + year); canonical AMAC code is SBDU00.
  桫罗稳鸿: "SBDU00",
  桫罗稳鸿C类: "SBDU00",
  金舆稳健增长1号FOF: "SCU622",
}

/** Reject email product_codes that are clearly not 备案号 (e.g. C2026 = C + year). */
function isPlausibleEmailProductCode(code: string | null | undefined): boolean {
  const c = (code ?? "").trim().toUpperCase()
  if (!c) return false
  if (/^[ABC](?:19|20)\d{2}$/.test(c)) return false
  return /^[A-Z0-9]{4,10}$/.test(c)
}

function teamDataBeianOverride(productName: string): string | null {
  const name = productName.trim()
  if (!name) return null
  const exact = TEAM_DATA_BEIAN_OVERRIDES[name]
  if (exact) return exact
  for (const [key, code] of Object.entries(TEAM_DATA_BEIAN_OVERRIDES)) {
    if (fundNamesMatch(key, name) && shareClassFromFundName(key) === shareClassFromFundName(name)) {
      return code
    }
  }
  return null
}

function productNameDedupeKey(productName: string): string {
  const cls = shareClassFromFundName(productName) || ""
  return `${fundNameBase(productName).toLowerCase()}|${cls}`
}

export type TeamDataElementsFilter = "all" | "missing" | "present"

export type TeamDataListParams = {
  page: number
  pageSize: number
  keyword: string
  strategySource: "company" | "platform"
  strategyL1: string
  strategyL2: string
  strategyL3: string
  /** Filter by whether 产品要素 (申赎字段) exist in basicinfo_bfl_track. */
  elementsFilter?: TeamDataElementsFilter
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
  /** Last edit / sync time — used for default newest-first ordering. */
  updated_at: string | null
}

type RawEmailFund = {
  fund_key: string
  product_code: string | null
  fund_name: string | null
  team_nav_date: string
  team_nav: string
  updated_at: string
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
  updated_at: string
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
  created_at: string
}

function maxIsoTimestamp(a: string | null | undefined, b: string | null | undefined): string {
  const left = (a ?? "").trim()
  const right = (b ?? "").trim()
  if (!left) return right
  if (!right) return left
  return left.localeCompare(right) >= 0 ? left : right
}

export function invalidateTeamDataListCaches(): void {
  emailFundsCache = null
  identityCache = null
}

/** Resolve manually added 团队数据 products for fund detail API fallback. */
export async function lookupTeamDataProductFundInfo(identifier: string): Promise<{
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
} | null> {
  const id = identifier.trim()
  if (!id) return null

  await ensureTeamDataProductsTable()

  const rows = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name
     FROM ops_team_data_products
     WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))
        OR ${sqlFundNameMatch("product_name", "$1")}
     ORDER BY CASE WHEN UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1)) THEN 0 ELSE 1 END
     LIMIT 1`,
    [id],
  )
  const row = rows[0]
  if (!row?.beian_hao?.trim()) return null

  const beian_hao = row.beian_hao.trim()
  const product_name = row.product_name.trim()

  let strategy_l1: string | null = null
  let strategy_l2: string | null = null
  let strategy_l3: string | null = null
  let short_name: string | null = product_name
  try {
    const { indexes } = await loadIdentityTables()
    const bfl = indexes.bflByBeian.get(beian_hao)
    const t6 = indexes.t6ByRegister.get(beian_hao)
    const fromT6 = strategiesFromRow(t6 ?? null, "company")
    const fromBfl = strategiesFromRow(bfl ?? null, "company")
    strategy_l1 = fromT6.l1 ?? fromBfl.l1
    strategy_l2 = fromT6.l2 ?? fromBfl.l2
    strategy_l3 = fromT6.l3 ?? fromBfl.l3
    short_name = displayProductName(
      bfl?.product_name ?? null,
      bfl?.short_name ?? t6?.fund_short_name ?? null,
      product_name,
    )
  } catch {
    // optional metadata
  }

  return { beian_hao, product_name, short_name, strategy_l1, strategy_l2, strategy_l3 }
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
    `SELECT beian_hao, product_name, created_at::text AS created_at
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
    updated_at: manual.created_at?.trim() || "",
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
  updated_at: "updated_at",
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

export type EmailPoolFund = {
  register_number: string
  product_name: string
}

async function loadRawEmailFundsFromValuation(): Promise<RawEmailFund[]> {
  await ensureEmailValuationTable()
  return query<RawEmailFund>(
    `WITH val_ranked AS (
       SELECT
         NULLIF(BTRIM(product_code), '') AS product_code,
         NULLIF(BTRIM(fund_name), '') AS fund_name,
         valuation_date,
         unit_nav,
         COALESCE(
           NULLIF(BTRIM(product_code), ''),
           NULLIF(BTRIM(fund_name), '')
         ) AS fund_key
       FROM ops_email_valuation_records
       WHERE unit_nav IS NOT NULL AND valuation_date IS NOT NULL
     )
     SELECT DISTINCT ON (fund_key)
       fund_key,
       product_code,
       fund_name,
       valuation_date::text AS team_nav_date,
       unit_nav::text AS team_nav
     FROM val_ranked
     WHERE fund_key IS NOT NULL
     ORDER BY fund_key, valuation_date DESC`,
  )
}

async function loadRawEmailFundsFromSubjects(): Promise<RawEmailFund[]> {
  await Promise.all([ensureEmailNavTable(), ensureEmailValuationTable()])
  const rows = await query<{ subject: string }>(
    `SELECT DISTINCT subject FROM (
       SELECT subject FROM ops_email_nav_records
       WHERE NULLIF(BTRIM(subject), '') IS NOT NULL
       UNION ALL
       SELECT subject FROM ops_email_valuation_records
       WHERE NULLIF(BTRIM(subject), '') IS NOT NULL
     ) s`,
  )
  const subjects = new Set(rows.map((r) => r.subject.trim()).filter(Boolean))
  // Parse-record subjects are discovery-only. Skip failed non-NAV mail
  // (合同变更 / 信披月报 / 公告) that polluted 邮箱运维池 with junk names.
  for (const rec of getAllEmailParseRecords()) {
    const subject = rec.subject?.trim()
    if (!subject) continue
    const anySuccess =
      rec.tableNavStatus === "成功" ||
      rec.postTableNavStatus === "成功" ||
      rec.valuationStatus === "成功" ||
      rec.ledgerStatus === "成功"
    if (!anySuccess) continue
    subjects.add(subject)
  }

  const out: RawEmailFund[] = []
  for (const subject of subjects) {
    const meta = extractNavMetadata(subject, "")
    const productCode = meta.productCode?.trim() || null
    const fundName = meta.fundName?.trim() || null
    if (!productCode && !fundName) continue
    // Subject-only rows without a product code are name-only pool keys and
    // cannot join NAV cache — only keep them when the name looks product-like.
    if (!productCode && !/号|类/u.test(fundName!)) continue
    const fund_key = productCode ?? fundName!
    out.push({
      fund_key,
      product_code: productCode,
      fund_name: fundName,
      team_nav_date: "",
      team_nav: "",
    })
  }
  return out
}

async function loadAllRawEmailFundRows(): Promise<RawEmailFund[]> {
  const [navRows, valRows, subjectRows] = await Promise.all([
    loadRawEmailFunds(),
    loadRawEmailFundsFromValuation(),
    loadRawEmailFundsFromSubjects(),
  ])
  return dedupeRawFunds([...navRows, ...valRows, ...subjectRows])
}

function emailPoolRegisterNumber(resolved: ResolvedFund, raw: RawEmailFund): string | null {
  const beian = resolved.beian_hao?.trim()
  if (beian) return beian
  const code = raw.product_code?.trim()
  if (code) return code.toUpperCase()
  const id = resolved.id?.trim()
  return id || null
}

/** Manager names / parse noise that must never become 邮箱运维池 rows. */
const EMAIL_POOL_JUNK_DENYLIST = new Set(
  [
    "青岛立心",
    "泉州棕榈滩",
    "上海务扬",
    "上海众量",
    "上海诚奇",
    "上海奇盾世家",
    "国泰海通金舆基石一号",
    "2026年07月07日金舆基石一号",
    "aaa私募",
    "号",
    "上海务扬A类",
    "私募",
    "基金",
    "证券",
    "投资",
    "证券投资",
    "私募基金",
    "投资基金",
  ].map((s) => s.trim().toLowerCase()),
)

function isJunkTeamDataProductName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim()
  if (!n) return true
  if (n.length < 3) return true
  if (EMAIL_POOL_JUNK_DENYLIST.has(n.toLowerCase())) return true
  if (/^(?:私募|基金|证券|投资|证券投资)$/u.test(n)) return true
  return false
}

/** Product-name tokens that distinguish a fund from a bare manager/company label. */
const EMAIL_POOL_FUND_NAME_MARKERS =
  /号|类|私募|证券|基金|专享|投资|对冲|CTA|量化|成长|精选|均衡|基石|轮动|文艺复兴/u

function isEmailPoolCompanyOrAnnouncementName(name: string): boolean {
  if (/^关于/u.test(name)) return true
  if (/管理有限公司|基金管理有限公司/u.test(name)) return true
  if (/^有限公司/u.test(name)) return true
  if (/有限公司/u.test(name) && !/号/u.test(name)) return true
  return false
}

function isPlausibleEmailPoolFund(productName: string, registerNumber: string): boolean {
  const name = productName.trim()
  const reg = registerNumber.trim()
  if (!name || !reg) return false
  if (name.length < 4 || reg.length < 2) return false
  if (name === "号" || reg === "号") return false
  if (!/[\u4e00-\u9fffA-Za-z]/.test(name)) return false
  if (isJunkTeamDataProductName(name)) return false
  if (isEmailPoolCompanyOrAnnouncementName(name)) return false
  if (isEmailPoolCompanyOrAnnouncementName(reg)) return false

  const nameKey = name.toLowerCase()
  const regKey = reg.toLowerCase()
  if (EMAIL_POOL_JUNK_DENYLIST.has(nameKey) || EMAIL_POOL_JUNK_DENYLIST.has(regKey)) {
    return false
  }

  // Attachment parses sometimes yield a bare code with no fund_name (e.g. SAUY00).
  // Those are not real products for 邮箱运维池.
  if (
    isFundCodeRegisterNumber(name) &&
    name.toUpperCase() === reg.toUpperCase()
  ) {
    return false
  }
  if (!/[\u4e00-\u9fff]/u.test(name)) return false

  // Name-only pool keys (no 备案号) must look like fund products, not manager labels.
  if (!isFundCodeRegisterNumber(reg)) {
    if (reg === name && !EMAIL_POOL_FUND_NAME_MARKERS.test(name)) return false
    if (/^20\d{2}年/.test(name) || /^20\d{2}年/.test(reg)) return false
    // Short labels without 号/类 are almost always manager fragments (青岛立心…).
    if (!/号|类/u.test(name) && name.length <= 10) return false
  }

  return true
}

function isFundCodeRegisterNumber(reg: string): boolean {
  return /^[A-Z0-9]{4,10}$/i.test(reg.trim())
}

function upgradePoolRegisterNumber(fund: EmailPoolFund, indexes: IdentityIndexes): EmailPoolFund {
  if (isFundCodeRegisterNumber(fund.register_number)) return fund
  const candidate = fund.product_name.trim()
  const bfl = bestBflMatch(indexes, candidate, null)
  if (bfl?.beian_hao?.trim()) {
    return { ...fund, register_number: bfl.beian_hao.trim() }
  }
  const t6 = bestT6Match(indexes, candidate, null)
  if (t6?.register_number?.trim()) {
    return { ...fund, register_number: t6.register_number.trim() }
  }
  return fund
}

function isParentFundRegisterNumber(reg: string): boolean {
  const u = reg.trim().toUpperCase()
  return isFundCodeRegisterNumber(u) && !/[ABC]$/.test(u)
}

/** Stable display name per 备案号 — parent SBAH99 must not inherit A/C类 labels from email rows. */
function canonicalEmailPoolProductName(
  registerNumber: string,
  resolvedName: string,
  indexes: IdentityIndexes,
  emailNameByCode?: string,
): string {
  const reg = registerNumber.trim()
  const upper = reg.toUpperCase()
  const bfl = indexes.bflByBeian.get(reg) ?? indexes.bflByBeian.get(upper)
  const t6 = indexes.t6ByRegister.get(reg) ?? indexes.t6ByRegister.get(upper)
  const emailName = emailNameByCode?.trim() ?? ""
  if (emailName && bfl?.product_name?.trim()) {
    const bflDisplay = displayProductName(bfl.product_name, bfl.short_name, bfl.product_name)
    if (!fundNamesMatch(bflDisplay, emailName) && !fundNamesMatch(bfl.product_name, emailName)) {
      return normalizeFundDisplayName(emailName) ?? emailName
    }
  }
  if (bfl?.product_name?.trim()) {
    return displayProductName(bfl.product_name, bfl.short_name, bfl.product_name)
  }
  if (t6?.fund_short_name?.trim()) return t6.fund_short_name.trim()

  const name = resolvedName.trim()
  const suffix = upper.match(/([ABC])$/)?.[1]
  if (suffix) {
    if (!name.includes(`${suffix}类`)) {
      const base = fundNameBase(name)
      return base ? `${base}${suffix}类` : name
    }
    return name
  }
  if (isParentFundRegisterNumber(reg) && /[ABC]类/u.test(name)) {
    const base = fundNameBase(name)
    return base || name
  }
  return name
}

function emailPoolRowIdentityScore(
  raw: RawEmailFund,
  registerNumber: string,
  candidate: string,
): number {
  const reg = registerNumber.trim().toUpperCase()
  const code = raw.product_code?.trim().toUpperCase() ?? ""
  let score = 0
  if (code === reg) score += 20
  else if (code && shareClassProductCodesMatch(code, reg)) score += 2

  const regSuffix = reg.match(/([ABC])$/)?.[1]
  const nameSuffix = candidate.match(/([ABC])类/u)?.[1]
  if (regSuffix && nameSuffix === regSuffix) score += 10
  else if (!regSuffix && !nameSuffix) score += 10
  else if (!regSuffix && nameSuffix) score -= 15
  else if (regSuffix && !nameSuffix) score -= 5
  return score
}

/** One pool row per display name — prefer 备案号/product code over Chinese name keys. */
function dedupeEmailPoolFundsByDisplayName(funds: EmailPoolFund[]): EmailPoolFund[] {
  const coded = funds.filter((f) => isFundCodeRegisterNumber(f.register_number))
  const nameOnly = funds.filter((f) => !isFundCodeRegisterNumber(f.register_number))
  const codedNames = new Set(coded.map((f) => f.product_name.trim().toLowerCase()))
  return [
    ...coded,
    ...nameOnly.filter((f) => !codedNames.has(f.product_name.trim().toLowerCase())),
  ]
}

/** Every fund discovered from email NAV, valuation, or parse subjects — for 邮箱运维池 sync. */
export async function loadEmailPoolFunds(): Promise<EmailPoolFund[]> {
  const [{ indexes }, rawRows] = await Promise.all([
    loadIdentityTables(),
    loadAllRawEmailFundRows(),
  ])

  const byRegister = new Map<string, EmailPoolFund & { navDate: string; identityScore: number }>()
  const emailNameByRegister = new Map<string, { name: string; navDate: string; identityScore: number }>()
  for (const row of rawRows) {
    const resolved = resolveFund(row, indexes, "company")
    const register_number = emailPoolRegisterNumber(resolved, row)
    if (!register_number || !isPlausibleEmailPoolFund(resolved.product_name, register_number)) continue
    const candidate = nameCandidate(row)
    const identityScore = emailPoolRowIdentityScore(row, register_number, candidate)
    const code = row.product_code?.trim().toUpperCase() ?? ""
    const regUpper = register_number.trim().toUpperCase()
    if (code && code === regUpper) {
      const prevEmail = emailNameByRegister.get(regUpper)
      if (
        !prevEmail
        || row.team_nav_date.localeCompare(prevEmail.navDate) > 0
        || (row.team_nav_date === prevEmail.navDate && identityScore > prevEmail.identityScore)
      ) {
        emailNameByRegister.set(regUpper, {
          name: candidate,
          navDate: row.team_nav_date,
          identityScore,
        })
      }
    }
    const prev = byRegister.get(register_number)
    if (
      !prev
      || row.team_nav_date.localeCompare(prev.navDate) > 0
      || (row.team_nav_date === prev.navDate && identityScore > prev.identityScore)
    ) {
      byRegister.set(register_number, {
        register_number,
        product_name: resolved.product_name,
        navDate: row.team_nav_date,
        identityScore,
      })
    }
  }

  const merged = new Map<string, EmailPoolFund>()
  for (const { register_number, product_name } of byRegister.values()) {
    const upgraded = upgradePoolRegisterNumber({ register_number, product_name }, indexes)
    merged.set(upgraded.register_number, {
      register_number: upgraded.register_number,
      product_name: canonicalEmailPoolProductName(
        upgraded.register_number,
        upgraded.product_name,
        indexes,
        emailNameByRegister.get(upgraded.register_number.trim().toUpperCase())?.name,
      ),
    })
  }
  return dedupeEmailPoolFundsByDisplayName(Array.from(merged.values()))
}

async function loadRawEmailFunds(): Promise<RawEmailFund[]> {
  if (emailFundsCache && Date.now() - emailFundsCache.at < EMAIL_FUNDS_CACHE_TTL_MS) {
    return emailFundsCache.rows
  }
  await ensureEmailNavTable()
  const rows = await query<RawEmailFund & { subject?: string | null }>(
    `WITH email_ranked AS (
       SELECT
         e.id,
         NULLIF(BTRIM(e.product_code), '') AS product_code,
         NULLIF(BTRIM(e.fund_name), '') AS fund_name,
         NULLIF(BTRIM(e.subject), '') AS subject,
         e.nav_date,
         e.nav,
         e.source,
         e.created_at,
         COALESCE(
           NULLIF(BTRIM(e.product_code), ''),
           NULLIF(BTRIM(e.fund_name), '')
         ) AS fund_key
       FROM ops_email_nav_records e
       WHERE e.nav IS NOT NULL AND e.nav_date IS NOT NULL
     ),
     latest_edit AS (
       SELECT fund_key, MAX(created_at) AS updated_at
       FROM email_ranked
       GROUP BY fund_key
     ),
     latest_nav AS (
       SELECT DISTINCT ON (fund_key)
         fund_key,
         product_code,
         fund_name,
         subject,
         nav_date,
         nav
       FROM email_ranked
       -- Prefer the newest NAV date (same as fund-detail latest joins). Attachment-first
       -- ranking previously froze team_nav_date on older attachment_nav_table rows while
       -- newer post-investment virtual body emails (e.g. 虚拟业绩报酬_) were ignored.
       ORDER BY
         fund_key,
         nav_date DESC,
         CASE WHEN ${sqlPostInvestmentVirtualNavExpr("subject")} THEN 0 ELSE 1 END,
         ${EMAIL_NAV_SOURCE_PRIORITY.replace(/\be\./g, "")},
         CASE WHEN COALESCE(fund_name, '') NOT LIKE '资产净值公告_%' THEN 0 ELSE 1 END,
         id DESC
     )
     SELECT
       n.fund_key,
       n.product_code,
       n.fund_name,
       n.subject,
       n.nav_date::text AS team_nav_date,
       n.nav::text AS team_nav,
       e.updated_at::text AS updated_at
     FROM latest_nav n
     JOIN latest_edit e USING (fund_key)`,
  )
  const repaired = rows.map((row) => {
    if (!isJunkTeamDataProductName(row.fund_name) || !row.subject) {
      const { subject: _subject, ...rest } = row
      return rest
    }
    const meta = extractNavMetadata(row.subject, "")
    const fixedName = meta.fundName?.trim() || null
    const { subject: _subject, ...rest } = row
    if (!fixedName || isJunkTeamDataProductName(fixedName)) return rest
    return {
      ...rest,
      fund_name: fixedName,
      product_code: rest.product_code || meta.productCode || null,
    }
  })
  emailFundsCache = { rows: repaired, at: Date.now() }
  return repaired
}

function dedupeRawFunds(rows: RawEmailFund[]): RawEmailFund[] {
  const byKey = new Map<string, RawEmailFund>()
  for (const row of rows) {
    const key = dedupeKey(row)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, row)
      continue
    }
    const prevJunk = isJunkTeamDataProductName(nameCandidate(prev))
    const nextJunk = isJunkTeamDataProductName(nameCandidate(row))
    if (prevJunk && !nextJunk) {
      byKey.set(key, {
        ...row,
        team_nav_date: row.team_nav_date || prev.team_nav_date,
        team_nav: row.team_nav || prev.team_nav,
        updated_at: maxIsoTimestamp(row.updated_at, prev.updated_at),
      })
      continue
    }
    if (!prevJunk && nextJunk) {
      if (row.team_nav_date && row.team_nav_date.localeCompare(prev.team_nav_date || "") > 0) {
        byKey.set(key, {
          ...prev,
          team_nav_date: row.team_nav_date,
          team_nav: row.team_nav || prev.team_nav,
          product_code: prev.product_code || row.product_code,
          updated_at: maxIsoTimestamp(row.updated_at, prev.updated_at),
        })
      } else {
        byKey.set(key, {
          ...prev,
          updated_at: maxIsoTimestamp(row.updated_at, prev.updated_at),
        })
      }
      continue
    }
    if (row.team_nav_date.localeCompare(prev.team_nav_date) > 0) {
      byKey.set(key, {
        ...row,
        updated_at: maxIsoTimestamp(row.updated_at, prev.updated_at),
      })
    } else if (row.team_nav_date === prev.team_nav_date && row.product_code && !prev.product_code) {
      byKey.set(key, {
        ...row,
        updated_at: maxIsoTimestamp(row.updated_at, prev.updated_at),
      })
    } else {
      byKey.set(key, {
        ...prev,
        updated_at: maxIsoTimestamp(row.updated_at, prev.updated_at),
      })
    }
  }
  return Array.from(byKey.values())
}

function beianPreferScore(code: string): number {
  const c = code.trim().toUpperCase()
  if (!c) return -1000
  if (/^[ABC](?:19|20)\d{2}$/.test(c)) return -100
  if (/^S[A-Z0-9]{5,}$/.test(c)) return 40
  if (/^[A-Z]{2,}\d{2,}[A-Z]?$/.test(c)) return 20
  return 0
}

function dedupeResolvedByBeian(rows: ResolvedFund[]): ResolvedFund[] {
  const byBeian = new Map<string, ResolvedFund>()
  const noBeian: ResolvedFund[] = []
  for (const row of rows) {
    if (!row.beian_hao?.trim()) {
      noBeian.push(row)
      continue
    }
    const key = row.beian_hao.trim().toUpperCase()
    const prev = byBeian.get(key)
    if (!prev || row.team_nav_date.localeCompare(prev.team_nav_date) > 0) {
      byBeian.set(key, {
        ...row,
        updated_at: maxIsoTimestamp(row.updated_at, prev?.updated_at),
      })
    } else {
      byBeian.set(key, {
        ...prev,
        updated_at: maxIsoTimestamp(row.updated_at, prev.updated_at),
      })
    }
  }

  // Collapse same display-name under different codes (e.g. C2026 vs SBDU00).
  const byName = new Map<string, ResolvedFund>()
  for (const row of byBeian.values()) {
    const nameKey = productNameDedupeKey(row.product_name)
    const prev = byName.get(nameKey)
    if (!prev) {
      byName.set(nameKey, row)
      continue
    }
    const prevScore = beianPreferScore(prev.beian_hao || "")
    const nextScore = beianPreferScore(row.beian_hao || "")
    const preferNext =
      nextScore > prevScore
      || (nextScore === prevScore && row.team_nav_date.localeCompare(prev.team_nav_date) > 0)
    const winner = preferNext ? row : prev
    byName.set(nameKey, {
      ...winner,
      updated_at: maxIsoTimestamp(row.updated_at, prev.updated_at),
    })
  }

  // Drop name-only rows when the same product already resolved with a 备案号
  // (older emails / subject parses often omit product_code).
  const codedNameKeys = new Set([...byName.keys()])
  const keptNoBeian = noBeian.filter((r) => !codedNameKeys.has(productNameDedupeKey(r.product_name)))
  return [...byName.values(), ...keptNoBeian]
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

  const autoBeian = (() => {
    const code = row.product_code?.trim() || null
    if (code && isPlausibleEmailProductCode(code) && codeMatchesShareClass(code, candidate)) {
      return code
    }
    const fromIdentity = bfl?.beian_hao ?? t6?.register_number ?? fd?.beian_hao ?? track?.beian_hao ?? null
    if (fromIdentity) return fromIdentity
    return code && isPlausibleEmailProductCode(code) ? code : null
  })()

  const product_name = displayProductName(
    fd?.product_name ?? track?.product_name ?? bfl?.product_name,
    bfl?.short_name ?? t6?.fund_short_name,
    candidate,
  )

  const overrideBeian = teamDataBeianOverride(product_name) ?? teamDataBeianOverride(candidate)
  const managedBeian = resolveManagedProductBeian(product_name, autoBeian) ?? autoBeian
  const beian_hao = (overrideBeian ?? managedBeian)?.trim() || null

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
    updated_at: row.updated_at?.trim() || "",
  }
}

function mergeLatestTeamNav(
  emailDate: string,
  emailNav: string,
  manualRows: Array<{ nav_date: string; unit_nav: string }> | undefined,
): { team_nav_date: string; team_nav: string } {
  let bestDate = emailDate.trim()
  let bestNav = emailNav.trim()
  for (const row of manualRows ?? []) {
    if (!bestDate || row.nav_date.localeCompare(bestDate) > 0) {
      bestDate = row.nav_date
      bestNav = row.unit_nav
    } else if (row.nav_date === bestDate) {
      bestNav = row.unit_nav
    }
  }
  return { team_nav_date: bestDate, team_nav: bestNav }
}

async function overlayManualTeamNav(rows: ResolvedFund[]): Promise<ResolvedFund[]> {
  const beians = [...new Set(rows.map((r) => r.beian_hao?.trim()).filter(Boolean) as string[])]
  if (beians.length === 0) return rows
  const [manualByBeian, manualEditRows] = await Promise.all([
    loadManualTeamNavBatch(beians),
    query<{ beian_hao: string; updated_at: string }>(
      `SELECT beian_hao, MAX(created_at)::text AS updated_at
       FROM ops_team_nav_manual
       WHERE beian_hao = ANY($1::text[])
       GROUP BY beian_hao`,
      [beians],
    ).catch(() => [] as Array<{ beian_hao: string; updated_at: string }>),
  ])
  const manualEditByBeian = new Map(
    manualEditRows.map((r) => [r.beian_hao.trim(), r.updated_at]),
  )
  if (manualByBeian.size === 0 && manualEditByBeian.size === 0) return rows
  return rows.map((row) => {
    if (!row.beian_hao) return row
    const manual = manualByBeian.get(row.beian_hao)
    const manualEdit = manualEditByBeian.get(row.beian_hao)
    const updated_at = maxIsoTimestamp(row.updated_at, manualEdit)
    if (!manual?.length) {
      return updated_at === row.updated_at ? row : { ...row, updated_at }
    }
    const merged = mergeLatestTeamNav(row.team_nav_date, row.team_nav, manual)
    return { ...row, ...merged, updated_at }
  })
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
    const teamNav = row.team_nav?.trim() || null
    const teamNavDate = row.team_nav_date?.trim() || null
    return {
      id: row.id,
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      platform_nav: plat?.nav ?? null,
      platform_nav_date: plat?.price_date ?? null,
      team_nav: teamNav,
      team_nav_date: teamNavDate,
      valuation_date: row.beian_hao ? (vmByCode.get(row.beian_hao) ?? null) : null,
      product_source: row.product_source,
      strategy_l1: row.strategy_l1,
      updated_at: row.updated_at?.trim() || null,
    }
  })
}

function compareRows(a: TeamDataListRow, b: TeamDataListRow, sort: string, dir: "ASC" | "DESC"): number {
  const col = EMAIL_FUNDS_SORT[sort] ?? "updated_at"
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

/** Beians that have usable 产品要素 (申赎) fields — matches 要素查询 dialog content. */
async function loadBeiansWithFundElements(beians: string[]): Promise<Set<string>> {
  const codes = [...new Set(beians.map((b) => b.trim()).filter(Boolean))]
  if (codes.length === 0) return new Set()
  const rows = await query<{ code: string }>(
    `SELECT DISTINCT COALESCE(NULLIF(BTRIM(register_number), ''), NULLIF(BTRIM(record_key), '')) AS code
     FROM basicinfo_bfl_track
     WHERE (register_number = ANY($1::text[]) OR record_key = ANY($1::text[]))
       AND (
         mandator_name IS NOT NULL
         OR open_day IS NOT NULL
         OR fee_manage_rate IS NOT NULL
         OR fee_trust IS NOT NULL
         OR fee_purchase IS NOT NULL
         OR fee_redeem IS NOT NULL
         OR closed_period IS NOT NULL
         OR precautious_line IS NOT NULL
         OR stop_line IS NOT NULL
         OR NULLIF(BTRIM(fee_manage), '') IS NOT NULL
         OR NULLIF(BTRIM(fee_admin_service), '') IS NOT NULL
         OR NULLIF(BTRIM(fee_pay), '') IS NOT NULL
       )`,
    [codes],
  ).catch(() => [] as { code: string }[])
  return new Set(rows.map((r) => (r.code || "").trim()).filter(Boolean))
}

export async function listTeamData(params: TeamDataListParams): Promise<{
  data: TeamDataListRow[]
  total: number
}> {
  const {
    page,
    pageSize,
    keyword,
    strategySource,
    strategyL1,
    strategyL2,
    strategyL3,
    elementsFilter = "all",
    sort,
    sortDir,
  } = params

  const [rawRows, manualProducts, { indexes }] = await Promise.all([
    loadRawEmailFunds().then(dedupeRawFunds),
    loadManualTeamDataProducts(),
    loadIdentityTables(),
  ])

  let resolved = dedupeResolvedByBeian(rawRows.map((row) => resolveFund(row, indexes, strategySource)))
  resolved = resolved.filter((r) => !isJunkTeamDataProductName(r.product_name))
  resolved = mergeManualTeamDataProducts(resolved, manualProducts, indexes, strategySource)
  resolved = await overlayManualTeamNav(resolved)

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

  if (elementsFilter === "missing" || elementsFilter === "present") {
    const beians = resolved.map((r) => r.beian_hao?.trim() || "").filter(Boolean)
    const withElements = await loadBeiansWithFundElements(beians)
    resolved = resolved.filter((r) => {
      const beian = r.beian_hao?.trim() || ""
      const has = !!beian && withElements.has(beian)
      return elementsFilter === "present" ? has : !has
    })
  }

  const effectiveSort = sort || "updated_at"
  const effectiveDir = sort ? sortDir : "DESC"
  const sorted = [...resolved].sort((a, b) =>
    compareRows(
      { ...a, platform_nav: null, platform_nav_date: null, valuation_date: null },
      { ...b, platform_nav: null, platform_nav_date: null, valuation_date: null },
      effectiveSort,
      effectiveDir,
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
