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
  guardQuery: string,
  limit = 10,
): Promise<PrivateFundPickerResult[]> {
  const trimmed = candidate.trim()
  if (!trimmed) return []
  const ilike = `%${trimmed.slice(0, Math.min(trimmed.length, 16))}%`
  const shareClassGuard = sqlShareClassProductNameGuard("product_name", "$2")

  return query<PrivateFundPickerResult>(
    `SELECT beian_hao, product_name, short_name, strategy_one
     FROM (
       SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1 AS strategy_one
       FROM private_fund_info
       WHERE TRIM(product_name) <> ''
         AND (
           ${sqlFundNameMatch("product_name", "$1")}
           OR beian_hao ILIKE $3
         )
         AND ${shareClassGuard}
       UNION
       SELECT beian_hao, product_name, short_name, strategy_one
       FROM private_fund_info_bfl
       WHERE TRIM(product_name) <> ''
         AND (
           ${sqlFundNameMatch("product_name", "$1")}
           OR ${sqlFundNameMatch("short_name", "$1")}
           OR beian_hao ILIKE $3
         )
         AND ${shareClassGuard}
     ) t
     WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
     ORDER BY ${sqlFundNameMatchPriority("product_name", "$1")}, product_name ASC
     LIMIT $4`,
    [trimmed, guardQuery, ilike, limit],
  ).catch((err) => {
    console.error("[private-fund-product-search] searchProductsByName", err)
    return []
  })
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

  const queryShareClass = shareClassFromProductName(trimmed)
  const baseGuardQuery = queryShareClass ? stripShareClassSuffix(trimmed) : trimmed

  const scored = new Map<string, { row: PrivateFundPickerResult; score: number }>()
  const addRow = (row: PrivateFundPickerResult, score: number) => {
    const beian = row.beian_hao?.trim()
    const name = row.product_name?.trim()
    if (!beian || !name) return
    if (queryShareClass && !shareClassProductNamesMatch(name, trimmed)) return
    if (!queryShareClass && shareClassFromProductName(name)) return
    if (!shareClassCodeMatchesProduct(beian, name)) return
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
    for (const row of await searchProductsByName(candidate, trimmed, limit)) {
      addRow(row, 5 + i)
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
    }
  }

  return Array.from(scored.values())
    .sort((a, b) => a.score - b.score || a.row.product_name.localeCompare(b.row.product_name, "zh-CN"))
    .slice(0, limit)
    .map((entry) => entry.row)
}
