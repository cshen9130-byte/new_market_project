import { query } from "@/lib/db"
import {
  sqlFundNameMatch,
  sqlFundNameMatchPriority,
  sqlShareClassProductNameGuard,
  shareClassCodeMatchesProduct,
  shareClassProductNamesMatch,
} from "@/lib/server/fund-name-match"
import {
  buildTieredBeianCode,
  buildTieredFullName,
  buildTieredShortName,
  shareClassFromProductName,
  stripShareClassSuffix,
  type ShareClassLetter,
} from "@/lib/server/share-class-product"

export type FundPickerSearchRow = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one?: string | null
}

const INVALID_REGISTER_VALUES = new Set(["-", "—", "无", "null", "none", "n/a", "NA"])
const BEIAN_CODE_RE = /(?<![A-Z0-9])([A-Z][A-Z0-9]{4,7}[A-Z]?)(?![A-Z0-9])/gi

export function fundNameCore(name: string): string {
  return name
    .trim()
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)/g, "")
    .replace(/[ABC]类$/g, "")
    .trim()
}

export function normalizeRegisterCode(value: string | null | undefined): string | null {
  if (!value) return null
  const s = String(value).trim().toUpperCase()
  if (!s || INVALID_REGISTER_VALUES.has(s) || INVALID_REGISTER_VALUES.has(s.toLowerCase())) return null
  if (!/^[A-Z][A-Z0-9]{4,7}[A-Z]?$/.test(s)) return null
  return s
}

function extractRegisterCodesFromText(text: string): string[] {
  const out = new Set<string>()
  for (const match of text.toUpperCase().matchAll(BEIAN_CODE_RE)) {
    const code = normalizeRegisterCode(match[1])
    if (code) out.add(code)
  }
  return Array.from(out)
}

/** Build search name variants, including the segment after "管理人-产品" style dashes. */
export function collectFundSearchNameCandidates(q: string): string[] {
  const trimmed = q.trim()
  if (!trimmed) return []

  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string) => {
    const s = value.trim()
    if (!s || seen.has(s)) return
    seen.add(s)
    out.push(s)
  }

  add(trimmed)

  const core = fundNameCore(trimmed)
  if (core) add(core)

  for (const dash of ["-", "－", "—", "–"]) {
    const idx = trimmed.indexOf(dash)
    if (idx < 0) continue
    const afterDash = trimmed.slice(idx + dash.length).trim()
    if (afterDash.length >= 4) {
      add(afterDash)
      const afterCore = fundNameCore(afterDash)
      if (afterCore) add(afterCore)
    }
  }

  return out
}

export async function searchFundsByRegister(
  codes: string[],
  limit = 10,
): Promise<FundPickerSearchRow[]> {
  if (!codes.length) return []
  return query<FundPickerSearchRow>(
    `SELECT beian_hao, product_name, short_name
     FROM (
       SELECT beian_hao, product_name, short_name
       FROM private_fund_info_bfl
       WHERE beian_hao = ANY($1::text[])
       UNION
       SELECT beian_hao, product_name, NULL::text AS short_name
       FROM private_fund_info
       WHERE beian_hao = ANY($1::text[])
       UNION
       SELECT COALESCE(NULLIF(BTRIM(register_number), ''), record_key) AS beian_hao,
              fund_name AS product_name,
              NULL::text AS short_name
       FROM basicinfo_bfl_track
       WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
       UNION
       SELECT register_number AS beian_hao,
              COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS product_name,
              fund_name AS short_name
       FROM type6_ops_team_full
       WHERE register_number = ANY($1::text[])
     ) t
     WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
     ORDER BY product_name ASC
     LIMIT $2`,
    [codes, limit],
  ).catch((err) => {
    console.error("[fund-picker-search] searchFundsByRegister", err)
    return []
  })
}

function shareClassFromRegisterCode(code: string): ShareClassLetter | null {
  const m = String(code ?? "").trim().toUpperCase().match(/([ABC])$/u)
  return m ? (m[1] as ShareClassLetter) : null
}

function stripShareClassFromRegisterCode(code: string): string {
  return String(code ?? "").trim().toUpperCase().replace(/[ABC]$/u, "")
}

function isBaseProduct(row: Pick<FundPickerSearchRow, "beian_hao" | "product_name">): boolean {
  return !shareClassFromProductName(row.product_name)
    && !shareClassFromRegisterCode(row.beian_hao)
}

function baseNamesMatch(a: string, b: string): boolean {
  const na = fundNameCore(a).toLowerCase()
  const nb = fundNameCore(b).toLowerCase()
  if (!na || !nb) return false
  return na === nb || na.startsWith(nb) || nb.startsWith(na)
}

function synthesizeShareClass(row: FundPickerSearchRow, letter: ShareClassLetter): FundPickerSearchRow {
  return {
    beian_hao: buildTieredBeianCode(row.beian_hao, letter),
    product_name: buildTieredFullName(row.product_name, letter),
    short_name: buildTieredShortName(row.short_name, row.product_name, letter),
    strategy_one: row.strategy_one ?? null,
  }
}

function passesShareClassFilters(
  beian: string,
  name: string,
  queryShareClass: ShareClassLetter | null,
  originalQuery: string,
): boolean {
  if (queryShareClass) {
    if (!shareClassProductNamesMatch(name, originalQuery)) return false
    return shareClassCodeMatchesProduct(beian, name)
  }
  if (shareClassFromProductName(name) || shareClassFromRegisterCode(beian)) {
    return baseNamesMatch(name, originalQuery)
  }
  return true
}

export async function searchFundsByName(
  name: string,
  limit = 10,
  guardQuery?: string,
): Promise<FundPickerSearchRow[]> {
  const trimmed = name.trim()
  if (!trimmed) return []
  const core = fundNameCore(trimmed)
  const ilike = `%${trimmed.slice(0, Math.min(trimmed.length, 16))}%`
  const coreIlike = core ? `%${core.slice(0, Math.min(core.length, 12))}%` : ilike
  const guard = guardQuery ?? trimmed
  const usesShareClassGuard = guardQuery !== undefined
  const shareClassGuard = usesShareClassGuard
    ? sqlShareClassProductNameGuard("product_name", "$5")
    : "TRUE"
  const type6ShareClassGuard = usesShareClassGuard
    ? sqlShareClassProductNameGuard("COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name)", "$5")
    : "TRUE"

  return query<FundPickerSearchRow>(
    `SELECT beian_hao, product_name, short_name
     FROM (
       SELECT beian_hao, product_name, short_name
       FROM private_fund_info_bfl
       WHERE (${sqlFundNameMatch("product_name", "$1")}
          OR ${sqlFundNameMatch("short_name", "$1")}
          OR product_name ILIKE $2
          OR short_name ILIKE $2
          OR product_name ILIKE $3
          OR short_name ILIKE $3)
         AND ${shareClassGuard}
       UNION
       SELECT beian_hao, product_name, NULL::text AS short_name
       FROM private_fund_info
       WHERE (${sqlFundNameMatch("product_name", "$1")}
          OR product_name ILIKE $2
          OR product_name ILIKE $3)
         AND ${shareClassGuard}
       UNION
       SELECT COALESCE(NULLIF(BTRIM(register_number), ''), record_key) AS beian_hao,
              fund_name AS product_name,
              NULL::text AS short_name
       FROM basicinfo_bfl_track
       WHERE (${sqlFundNameMatch("fund_name", "$1")}
          OR fund_name ILIKE $2
          OR fund_name ILIKE $3
          OR register_number ILIKE $2
          OR record_key ILIKE $2)
         AND ${shareClassGuard}
       UNION
       SELECT register_number AS beian_hao,
              COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS product_name,
              fund_name AS short_name
       FROM type6_ops_team_full
       WHERE (${sqlFundNameMatch("COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name)", "$1")}
          OR ${sqlFundNameMatch("fund_name", "$1")}
          OR ${sqlFundNameMatch("fund_short_name", "$1")}
          OR COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) ILIKE $2
          OR fund_name ILIKE $2
          OR fund_short_name ILIKE $2
          OR COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) ILIKE $3
          OR fund_name ILIKE $3
          OR fund_short_name ILIKE $3
          OR register_number ILIKE $2)
         AND ${type6ShareClassGuard}
     ) t
     WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
     ORDER BY ${sqlFundNameMatchPriority("product_name", "$1")}, product_name ASC
     LIMIT $4`,
    usesShareClassGuard ? [trimmed, ilike, coreIlike, limit, guard] : [trimmed, ilike, coreIlike, limit],
  ).catch((err) => {
    console.error("[fund-picker-search] searchFundsByName", err)
    return []
  })
}

async function searchFundsBroad(name: string, limit = 10): Promise<FundPickerSearchRow[]> {
  const trimmed = name.trim()
  if (!trimmed) return []
  const pattern = `%${trimmed}%`
  const prefix = `${trimmed}%`

  return query<FundPickerSearchRow>(
    `SELECT beian_hao, product_name, short_name
     FROM (
       SELECT beian_hao, product_name, short_name
       FROM private_fund_info_bfl
       WHERE product_name ILIKE $1 OR short_name ILIKE $1 OR beian_hao ILIKE $1
       UNION
       SELECT beian_hao, product_name, NULL::text AS short_name
       FROM private_fund_info
       WHERE product_name ILIKE $1 OR beian_hao ILIKE $1
       UNION
       SELECT COALESCE(NULLIF(BTRIM(register_number), ''), record_key) AS beian_hao,
              fund_name AS product_name,
              NULL::text AS short_name
       FROM basicinfo_bfl_track
       WHERE fund_name ILIKE $1
          OR register_number ILIKE $1
          OR record_key ILIKE $1
       UNION
       SELECT register_number AS beian_hao,
              COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS product_name,
              fund_name AS short_name
       FROM type6_ops_team_full
       WHERE COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) ILIKE $1
          OR fund_name ILIKE $1
          OR fund_short_name ILIKE $1
          OR register_number ILIKE $1
     ) t
     WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
     ORDER BY
       CASE
         WHEN beian_hao ILIKE $2 THEN 0
         WHEN product_name ILIKE $2 THEN 1
         ELSE 2
       END,
       product_name ASC
     LIMIT $3`,
    [pattern, prefix, limit],
  ).catch((err) => {
    console.error("[fund-picker-search] searchFundsBroad", err)
    return []
  })
}

async function enrichStrategyOne(rows: FundPickerSearchRow[]): Promise<FundPickerSearchRow[]> {
  const codes = Array.from(new Set(rows.map((r) => r.beian_hao).filter(Boolean)))
  if (!codes.length) return rows

  const strategyRows = await query<{ beian_hao: string; strategy_one: string | null }>(
    `SELECT beian_hao, strategy_one
     FROM private_fund_info_bfl
     WHERE beian_hao = ANY($1::text[])`,
    [codes],
  ).catch(() => [])

  const strategyByCode = new Map(strategyRows.map((r) => [r.beian_hao, r.strategy_one]))
  return rows.map((row) => ({
    ...row,
    strategy_one: strategyByCode.get(row.beian_hao) ?? row.strategy_one ?? null,
  }))
}

function addScoredRow(
  target: Map<string, { row: FundPickerSearchRow; score: number }>,
  row: FundPickerSearchRow,
  score: number,
  queryShareClass: ShareClassLetter | null,
  originalQuery: string,
) {
  const beian = (row.beian_hao ?? "").trim()
  const name = (row.product_name ?? "").trim()
  if (!beian || !name) return
  if (!passesShareClassFilters(beian, name, queryShareClass, originalQuery)) return
  const existing = target.get(beian)
  if (!existing || score < existing.score) {
    target.set(beian, { row: { beian_hao: beian, product_name: name, short_name: row.short_name ?? null }, score })
  }
}

/**
 * Multi-table fund search for picker / autocomplete inputs.
 * Matches the contract-extract matcher: register codes, fuzzy names, and post-dash segments.
 * Keeps A/B/C share classes separate; synthesizes tiered variants when only the base fund exists.
 */
export async function searchTrackingFunds(q: string, limit = 20): Promise<FundPickerSearchRow[]> {
  const trimmed = q.trim()
  if (!trimmed) return []

  const queryShareClass = shareClassFromProductName(trimmed)
  const baseGuardQuery = queryShareClass ? stripShareClassSuffix(trimmed) : trimmed

  const registerCodes = new Set<string>()
  const directCode = normalizeRegisterCode(trimmed)
  if (directCode) registerCodes.add(directCode)
  const directShareClass = directCode ? shareClassFromRegisterCode(directCode) : null
  if (directCode && directShareClass) {
    registerCodes.add(stripShareClassFromRegisterCode(directCode))
  }
  for (const code of extractRegisterCodesFromText(trimmed)) registerCodes.add(code)

  const nameCandidates = collectFundSearchNameCandidates(trimmed)
  const scored = new Map<string, { row: FundPickerSearchRow; score: number }>()

  if (registerCodes.size > 0) {
    for (const row of await searchFundsByRegister(Array.from(registerCodes), limit)) {
      addScoredRow(scored, row, 0, queryShareClass, trimmed)
      const rowShareClass = shareClassFromProductName(row.product_name) ?? shareClassFromRegisterCode(row.beian_hao)
      const wantedShareClass = queryShareClass ?? directShareClass
      if (wantedShareClass && isBaseProduct(row) && !rowShareClass) {
        addScoredRow(scored, synthesizeShareClass(row, wantedShareClass), 1, queryShareClass, trimmed)
      }
    }
  }

  for (let i = 0; i < nameCandidates.length; i++) {
    const candidate = nameCandidates[i]
    if (normalizeRegisterCode(candidate)) continue
    for (const row of await searchFundsByName(candidate, limit)) {
      addScoredRow(scored, row, 5 + i, queryShareClass, trimmed)
    }
  }

  if (scored.size === 0) {
    for (const row of await searchFundsBroad(trimmed, limit)) {
      addScoredRow(scored, row, 20, queryShareClass, trimmed)
    }
    for (const candidate of [fundNameCore(trimmed), baseGuardQuery].filter(Boolean)) {
      if (candidate === trimmed) continue
      for (const row of await searchFundsBroad(candidate, limit)) {
        addScoredRow(scored, row, 25, queryShareClass, trimmed)
      }
    }
  }

  if (queryShareClass) {
    const existingShareClass = Array.from(scored.values()).some(
      ({ row }) => shareClassFromProductName(row.product_name) === queryShareClass,
    )
    if (!existingShareClass) {
      const baseScored = new Map<string, { row: FundPickerSearchRow; score: number }>()
      for (let i = 0; i < nameCandidates.length; i++) {
        const candidate = nameCandidates[i]
        if (normalizeRegisterCode(candidate)) continue
        for (const row of await searchFundsByName(candidate, limit, baseGuardQuery)) {
          if (!isBaseProduct(row)) continue
          if (!baseNamesMatch(row.product_name, trimmed) && !(row.short_name && baseNamesMatch(row.short_name, trimmed))) {
            continue
          }
          const beian = row.beian_hao.trim()
          const existing = baseScored.get(beian)
          if (!existing || 5 + i < existing.score) {
            baseScored.set(beian, { row, score: 5 + i })
          }
        }
      }
      for (const { row, score } of baseScored.values()) {
        addScoredRow(scored, synthesizeShareClass(row, queryShareClass), 10 + score, queryShareClass, trimmed)
      }
      if (!Array.from(scored.values()).some(({ row }) => shareClassFromProductName(row.product_name) === queryShareClass)) {
        for (const row of await searchFundsBroad(baseGuardQuery, limit)) {
          if (!isBaseProduct(row)) continue
          if (!baseNamesMatch(row.product_name, trimmed) && !(row.short_name && baseNamesMatch(row.short_name, trimmed))) {
            continue
          }
          addScoredRow(scored, synthesizeShareClass(row, queryShareClass), 30, queryShareClass, trimmed)
        }
      }
    }
  }

  if (!queryShareClass) {
    const baseRows = Array.from(scored.values()).filter(({ row }) => isBaseProduct(row))
    for (const { row: base, score: baseScore } of baseRows) {
      for (const letter of ["A", "B", "C"] as ShareClassLetter[]) {
        const alreadyHas = Array.from(scored.values()).some(
          ({ row }) =>
            (shareClassFromProductName(row.product_name) === letter
              || shareClassFromRegisterCode(row.beian_hao) === letter)
            && baseNamesMatch(row.product_name, base.product_name),
        )
        if (!alreadyHas) {
          addScoredRow(scored, synthesizeShareClass(base, letter), baseScore + 8, queryShareClass, trimmed)
        }
      }
    }
  }

  const rows = Array.from(scored.values())
    .sort((a, b) => a.score - b.score || a.row.product_name.localeCompare(b.row.product_name, "zh-CN"))
    .slice(0, limit)
    .map((entry) => entry.row)

  return enrichStrategyOne(rows)
}
