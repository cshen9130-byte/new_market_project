import { query } from "@/lib/db"
import {
  collectFundSearchNameCandidates,
  fundNameCore,
  normalizeRegisterCode,
  type FundPickerSearchRow,
} from "@/lib/server/fund-picker-search"
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

export type PrivateFundPickerResult = FundPickerSearchRow & {
  strategy_one: string | null
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

function synthesizeShareClass(
  row: PrivateFundPickerResult,
  letter: ShareClassLetter,
): PrivateFundPickerResult {
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

async function searchProductsByRegister(codes: string[], limit = 10): Promise<PrivateFundPickerResult[]> {
  if (!codes.length) return []
  return query<PrivateFundPickerResult>(
    `SELECT beian_hao, product_name, short_name, strategy_one
     FROM (
       SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1 AS strategy_one
       FROM private_fund_info
       WHERE beian_hao = ANY($1::text[])
       UNION
       SELECT beian_hao, product_name, short_name, strategy_one
       FROM private_fund_info_bfl
       WHERE beian_hao = ANY($1::text[])
       UNION
       SELECT register_number AS beian_hao,
              COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS product_name,
              fund_name AS short_name,
              company_strategy_one AS strategy_one
       FROM type6_ops_team_full
       WHERE register_number = ANY($1::text[])
       UNION
       SELECT COALESCE(NULLIF(BTRIM(register_number), ''), record_key) AS beian_hao,
              fund_name AS product_name,
              NULL::text AS short_name,
              NULL::text AS strategy_one
       FROM basicinfo_bfl_track
       WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
     ) t
     WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
     ORDER BY product_name ASC
     LIMIT $2`,
    [codes, limit],
  ).catch((err) => {
    console.error("[private-fund-product-search] searchProductsByRegister", err)
    return []
  })
}

async function searchProductsByName(
  candidate: string,
  guardQuery: string | undefined,
  limit = 10,
): Promise<PrivateFundPickerResult[]> {
  const trimmed = candidate.trim()
  if (!trimmed) return []
  const ilike = `%${trimmed.slice(0, Math.min(trimmed.length, 16))}%`
  const core = fundNameCore(trimmed)
  const coreIlike = core ? `%${core.slice(0, Math.min(core.length, 12))}%` : ilike
  const usesShareClassGuard = guardQuery !== undefined
  const shareClassGuard = usesShareClassGuard
    ? sqlShareClassProductNameGuard("product_name", "$5")
    : "TRUE"
  const type6ShareClassGuard = usesShareClassGuard
    ? sqlShareClassProductNameGuard("COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name)", "$5")
    : "TRUE"
  const basicinfoShareClassGuard = usesShareClassGuard
    ? sqlShareClassProductNameGuard("fund_name", "$5")
    : "TRUE"

  return query<PrivateFundPickerResult>(
    `SELECT beian_hao, product_name, short_name, strategy_one
     FROM (
       SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1 AS strategy_one
       FROM private_fund_info
       WHERE TRIM(product_name) <> ''
         AND (
           ${sqlFundNameMatch("product_name", "$1")}
           OR product_name ILIKE $2
           OR product_name ILIKE $3
           OR beian_hao ILIKE $2
         )
         AND ${shareClassGuard}
       UNION
       SELECT beian_hao, product_name, short_name, strategy_one
       FROM private_fund_info_bfl
       WHERE TRIM(product_name) <> ''
         AND (
           ${sqlFundNameMatch("product_name", "$1")}
           OR ${sqlFundNameMatch("short_name", "$1")}
           OR product_name ILIKE $2
           OR short_name ILIKE $2
           OR product_name ILIKE $3
           OR beian_hao ILIKE $2
         )
         AND ${shareClassGuard}
       UNION
       SELECT register_number AS beian_hao,
              COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS product_name,
              fund_name AS short_name,
              company_strategy_one AS strategy_one
       FROM type6_ops_team_full
       WHERE TRIM(COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name)) <> ''
         AND (
           ${sqlFundNameMatch("COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name)", "$1")}
           OR ${sqlFundNameMatch("fund_name", "$1")}
           OR ${sqlFundNameMatch("fund_short_name", "$1")}
           OR COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) ILIKE $2
           OR fund_name ILIKE $2
           OR fund_short_name ILIKE $2
           OR COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) ILIKE $3
           OR register_number ILIKE $2
         )
         AND ${type6ShareClassGuard}
       UNION
       SELECT COALESCE(NULLIF(BTRIM(register_number), ''), record_key) AS beian_hao,
              fund_name AS product_name,
              NULL::text AS short_name,
              NULL::text AS strategy_one
       FROM basicinfo_bfl_track
       WHERE TRIM(fund_name) <> ''
         AND (
           ${sqlFundNameMatch("fund_name", "$1")}
           OR fund_name ILIKE $2
           OR fund_name ILIKE $3
           OR register_number ILIKE $2
           OR record_key ILIKE $2
         )
         AND ${basicinfoShareClassGuard}
     ) t
     WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
     ORDER BY ${sqlFundNameMatchPriority("product_name", "$1")}, product_name ASC
     LIMIT $4`,
    usesShareClassGuard
      ? [trimmed, ilike, coreIlike, limit, guardQuery]
      : [trimmed, ilike, coreIlike, limit],
  ).catch((err) => {
    console.error("[private-fund-product-search] searchProductsByName", err)
    return []
  })
}

async function searchProductsBroad(name: string, limit = 10): Promise<PrivateFundPickerResult[]> {
  const trimmed = name.trim()
  if (!trimmed) return []
  const pattern = `%${trimmed}%`
  const prefix = `${trimmed}%`

  return query<PrivateFundPickerResult>(
    `SELECT beian_hao, product_name, short_name, strategy_one
     FROM (
       SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1 AS strategy_one
       FROM private_fund_info
       WHERE product_name ILIKE $1 OR beian_hao ILIKE $1
       UNION
       SELECT beian_hao, product_name, short_name, strategy_one
       FROM private_fund_info_bfl
       WHERE product_name ILIKE $1 OR short_name ILIKE $1 OR beian_hao ILIKE $1
       UNION
       SELECT register_number AS beian_hao,
              COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS product_name,
              fund_name AS short_name,
              company_strategy_one AS strategy_one
       FROM type6_ops_team_full
       WHERE COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) ILIKE $1
          OR fund_name ILIKE $1
          OR fund_short_name ILIKE $1
          OR register_number ILIKE $1
       UNION
       SELECT COALESCE(NULLIF(BTRIM(register_number), ''), record_key) AS beian_hao,
              fund_name AS product_name,
              NULL::text AS short_name,
              NULL::text AS strategy_one
       FROM basicinfo_bfl_track
       WHERE fund_name ILIKE $1
          OR register_number ILIKE $1
          OR record_key ILIKE $1
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
    console.error("[private-fund-product-search] searchProductsBroad", err)
    return []
  })
}

/** Fast prefix search — same query shape as fund keyword autocomplete. */
export async function searchPrivateFundProductsPrefix(
  q: string,
  limit = 20,
): Promise<PrivateFundPickerResult[]> {
  const trimmed = q.trim()
  if (!trimmed) return []
  const prefix = `${trimmed}%`

  return query<PrivateFundPickerResult>(
    `SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1 AS strategy_one
     FROM private_fund_info
     WHERE TRIM(product_name) <> ''
       AND (product_name ILIKE $1 OR beian_hao ILIKE $1)
     ORDER BY product_name ASC
     LIMIT $2`,
    [prefix, limit],
  ).catch((err) => {
    console.error("[private-fund-product-search] searchPrivateFundProductsPrefix", err)
    return []
  })
}

function canUsePrefixFastPath(q: string): boolean {
  const trimmed = q.trim()
  if (!trimmed) return false
  if (normalizeRegisterCode(trimmed)) return false
  if (shareClassFromProductName(trimmed)) return false
  if (/[-－—–]/.test(trimmed)) return false
  return true
}

/**
 * Picker search for private fund products.
 * Keeps A/B/C share classes separate; synthesizes tiered variants when only the base fund exists.
 */
export async function searchPrivateFundProductsForPicker(
  q: string,
  limit = 20,
): Promise<PrivateFundPickerResult[]> {
  const trimmed = q.trim()
  if (!trimmed) return []

  if (canUsePrefixFastPath(trimmed)) {
    const fast = await searchPrivateFundProductsPrefix(trimmed, limit)
    if (fast.length > 0) return fast
  }

  const queryShareClass = shareClassFromProductName(trimmed)
  const baseGuardQuery = queryShareClass ? stripShareClassSuffix(trimmed) : trimmed

  const scored = new Map<string, { row: PrivateFundPickerResult; score: number }>()
  const addRow = (row: PrivateFundPickerResult, score: number) => {
    const beian = row.beian_hao?.trim()
    const name = row.product_name?.trim()
    if (!beian || !name) return
    if (!passesShareClassFilters(beian, name, queryShareClass, trimmed)) return
    const existing = scored.get(beian)
    if (!existing || score < existing.score) {
      scored.set(beian, { row: { ...row, beian_hao: beian, product_name: name }, score })
    }
  }

  const registerCodes = new Set<string>()
  const directCode = normalizeRegisterCode(trimmed)
  if (directCode) registerCodes.add(directCode)
  const directShareClass = directCode ? shareClassFromRegisterCode(directCode) : null
  if (directCode && directShareClass) {
    registerCodes.add(stripShareClassFromRegisterCode(directCode))
  }

  if (registerCodes.size > 0) {
    for (const row of await searchProductsByRegister(Array.from(registerCodes), limit)) {
      addRow(row, 0)
      const rowShareClass = shareClassFromProductName(row.product_name) ?? shareClassFromRegisterCode(row.beian_hao)
      const wantedShareClass = queryShareClass ?? directShareClass
      if (wantedShareClass && isBaseProduct(row) && !rowShareClass) {
        addRow(synthesizeShareClass(row, wantedShareClass), 1)
      }
    }
  }

  const candidates = collectFundSearchNameCandidates(trimmed)
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (normalizeRegisterCode(candidate)) continue
    for (const row of await searchProductsByName(candidate, undefined, limit)) {
      addRow(row, 5 + i)
    }
  }

  if (scored.size === 0) {
    for (const row of await searchProductsBroad(trimmed, limit)) {
      addRow(row, 20)
    }
    for (const candidate of [fundNameCore(trimmed), baseGuardQuery].filter(Boolean)) {
      if (candidate === trimmed) continue
      for (const row of await searchProductsBroad(candidate, limit)) {
        addRow(row, 25)
      }
    }
  }

  if (queryShareClass) {
    const existingShareClass = Array.from(scored.values()).some(
      ({ row }) => shareClassFromProductName(row.product_name) === queryShareClass,
    )
    if (!existingShareClass) {
      const baseScored = new Map<string, { row: PrivateFundPickerResult; score: number }>()
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i]
        if (normalizeRegisterCode(candidate)) continue
        for (const row of await searchProductsByName(candidate, baseGuardQuery, limit)) {
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
        addRow(synthesizeShareClass(row, queryShareClass), 10 + score)
      }
      if (!Array.from(scored.values()).some(({ row }) => shareClassFromProductName(row.product_name) === queryShareClass)) {
        for (const row of await searchProductsBroad(baseGuardQuery, limit)) {
          if (!isBaseProduct(row)) continue
          if (!baseNamesMatch(row.product_name, trimmed) && !(row.short_name && baseNamesMatch(row.short_name, trimmed))) {
            continue
          }
          addRow(synthesizeShareClass(row, queryShareClass), 30)
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
          addRow(synthesizeShareClass(base, letter), baseScore + 8)
        }
      }
    }
  }

  return Array.from(scored.values())
    .sort((a, b) => a.score - b.score || a.row.product_name.localeCompare(b.row.product_name, "zh-CN"))
    .slice(0, limit)
    .map((entry) => entry.row)
}
