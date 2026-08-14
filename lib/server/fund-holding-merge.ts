/**
 * Merge same-product 估值表 leaves that split across 科目.
 *
 * Typical 4-level 托管表 (国泰君安 / 华泰):
 *   11090601XXXX  成本/持仓 — 市值 already = 成本 + 估值增值
 *   11090699XXXX  估值增值 — satellite; keep / add / deduct vs the 01 line
 *   30032001XXXX  理财产品申购款 — 在途, not confirmed shares
 *   30032002XXXX  理财产品赎回款 — 在途, 1109 already reflects remaining shares
 *   1108 vs 1109  成本科目 vs 市价科目 — same book, keep 1109
 */

import { fundDisplayNamesMatch } from "@/lib/server/fund-name-match"
import {
  classifyValuationFundSubjectRole,
  extractListedFundCodeFromName,
  isValuationClearingSubjectCode,
  isValuationIncrementSubjectCode,
  resolveFofValuationCodeAlias,
  resolveFundHoldingCode,
  type ValuationFundSubjectRole,
} from "@/lib/server/fund-holding-code"
import { canonicalizeShareClassBeianCode } from "@/lib/server/share-class-product"

export type FundHoldingMergeRow = {
  subject_code?: string | null
  original_subject_code?: string | null
  subject_name?: string | null
  symbol?: string | null
  quantity?: string | number | null
  cost?: string | number | null
  signed_cost?: string | number | null
  market_value?: string | number | null
  signed_market_value?: string | number | null
  price?: string | number | null
  unrealized_pnl?: string | number | null
  row_kind?: string | null
  is_leaf?: boolean | null
  include_in_detail?: boolean | null
}

function parseAmt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const n = parseFloat(String(value ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

function compactCode(code: string | null | undefined): string {
  return String(code ?? "").replace(/[\s.]/g, "").toUpperCase()
}

function near(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1)
  return Math.abs(a - b) <= Math.max(2, scale * 0.0005)
}

function canonicalHoldingCode(row: FundHoldingMergeRow): string | null {
  const name = String(row.subject_name ?? "")
  const raw =
    resolveFundHoldingCode(
      String(row.subject_code ?? ""),
      name,
      row.symbol,
      row.original_subject_code,
    )
    ?? extractListedFundCodeFromName(name)
    ?? (String(row.symbol ?? "").trim() || null)
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  return resolveFofValuationCodeAlias(upper) ?? canonicalizeShareClassBeianCode(upper) ?? upper
}

function subjectRole(row: FundHoldingMergeRow): ValuationFundSubjectRole {
  return classifyValuationFundSubjectRole(row.subject_code ?? row.original_subject_code)
}

function positionPreference(row: FundHoldingMergeRow): number {
  const code = compactCode(row.subject_code)
  let score = 0
  if (row.is_leaf === true) score += 1_000
  if (Math.abs(parseAmt(row.quantity)) > 0) score += 500
  if (code.startsWith("1109")) score += 80
  else if (code.startsWith("1108")) score += 40
  if (parseAmt(row.price) > 0) score += 200
  score += Math.abs(parseAmt(row.signed_market_value) || parseAmt(row.market_value))
  return score
}

function sameProduct(a: FundHoldingMergeRow, b: FundHoldingMergeRow): boolean {
  const ca = canonicalHoldingCode(a)
  const cb = canonicalHoldingCode(b)
  if (ca && cb && ca === cb) return true
  return fundDisplayNamesMatch(String(a.subject_name ?? ""), String(b.subject_name ?? ""))
}

function groupSameProduct<T extends FundHoldingMergeRow>(rows: T[]): T[][] {
  const parent = rows.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (sameProduct(rows[i], rows[j])) {
        const a = find(i)
        const b = find(j)
        if (a !== b) parent[b] = a
      }
    }
  }
  const groups = new Map<number, T[]>()
  for (let i = 0; i < rows.length; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(rows[i])
    groups.set(root, list)
  }
  return [...groups.values()]
}

function withMarketValue<T extends FundHoldingMergeRow>(row: T, marketValue: number, signedMarketValue: number): T {
  return {
    ...row,
    market_value: marketValue,
    signed_market_value: signedMarketValue,
  }
}

/**
 * Combine 估值增值 into the 01/持仓 line.
 * Keep 01 when 市值 already equals 成本±增值; add/deduct when 市值 is still at cost.
 */
function applyValuationAdjustments<T extends FundHoldingMergeRow>(primary: T, adjs: T[]): T {
  if (adjs.length === 0) return primary
  const posMv = parseAmt(primary.signed_market_value) || parseAmt(primary.market_value)
  const posCost = parseAmt(primary.signed_cost) || parseAmt(primary.cost)
  const adjSum = adjs.reduce((s, r) => s + (parseAmt(r.signed_market_value) || parseAmt(r.market_value)), 0)
  const impliedPnl = posMv - posCost

  if (near(Math.abs(impliedPnl), Math.abs(adjSum))) {
    return primary
  }
  if (near(posMv, posCost + adjSum) || near(posMv, posCost - adjSum)) {
    return primary
  }
  if (near(posMv, posCost)) {
    const signedAdj = near(impliedPnl, 0)
      ? adjSum
      : Math.sign(impliedPnl || adjSum) * Math.abs(adjSum)
    const next = posMv + signedAdj
    return withMarketValue(primary, Math.abs(next) < 1e-9 ? next : next, next)
  }
  return primary
}

function pickPrimaryPosition<T extends FundHoldingMergeRow>(positions: T[]): T {
  return [...positions].sort((a, b) => positionPreference(b) - positionPreference(a))[0]
}

/** One economic holding per underlying product. */
export function mergeSameProductFundHoldings<T extends FundHoldingMergeRow>(rows: T[]): T[] {
  const merged: T[] = []
  for (const group of groupSameProduct(rows)) {
    const byRole = new Map<ValuationFundSubjectRole, T[]>()
    for (const row of group) {
      const role = subjectRole(row)
      const list = byRole.get(role) ?? []
      list.push(row)
      byRole.set(role, list)
    }
    const positions = byRole.get("position") ?? []
    const adjs = byRole.get("valuation_adj") ?? []
    if (positions.length === 0) continue

    const primary = applyValuationAdjustments(pickPrimaryPosition(positions), adjs)
    merged.push(primary)
  }
  return merged.sort((a, b) => {
    const mv = (r: T) => Math.abs(parseAmt(r.signed_market_value) || parseAmt(r.market_value))
    return mv(b) - mv(a)
  })
}

export function isFundHoldingMergeCandidate(row: {
  include_in_detail?: boolean | null
  is_leaf?: boolean | null
  subject_code?: string | null
  original_subject_code?: string | null
  subject_name?: string | null
  symbol?: string | null
  quantity?: string | number | null
  cost?: string | number | null
  signed_cost?: string | number | null
  market_value?: string | number | null
  signed_market_value?: string | number | null
  row_kind?: string | null
}): boolean {
  if (row.include_in_detail === false) return false
  if (row.is_leaf === false) return false
  const qty = Math.abs(parseAmt(row.quantity))
  const mv = parseAmt(row.signed_market_value) || parseAmt(row.market_value)
  const cost = parseAmt(row.signed_cost) || parseAmt(row.cost)
  if (qty <= 0 && Math.abs(mv) <= 0 && Math.abs(cost) <= 0) return false

  const code = row.subject_code ?? row.original_subject_code
  const name = String(row.subject_name ?? "")
  if (isValuationIncrementSubjectCode(code)) return true
  if (isValuationClearingSubjectCode(code)) {
    return /私募证券投资基金|私募基金/.test(name)
  }

  const kind = row.row_kind ?? "other"
  if (["bank_deposit", "settlement_reserve", "margin_deposit", "payable", "receivable", "clearing", "paid_in_capital"].includes(kind)) {
    return false
  }
  if (["private_fund", "fund_or_stock", "fund", "money_fund"].includes(kind)) return true
  const compact = String(code ?? "").replace(/[\s.]/g, "")
  if (compact.startsWith("1109") || compact.startsWith("1108")) return true
  if (/^银行存款|^结算备付金|^存出保证金/.test(name)) return false
  if (/私募证券投资基金|私募基金/.test(name)) return true
  if (kind === "other" && String(row.symbol ?? "").trim()) return true
  return false
}
