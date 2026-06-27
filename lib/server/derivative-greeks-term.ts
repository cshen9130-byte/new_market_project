/**
 * Greek letters + term analysis from 估值表 derivative/option holdings.
 */

import { extractContractRootSymbol } from "@/lib/server/derivative-sector"
import {
  extractOptionContractFromText,
  normalizeOptionContractCode,
} from "@/lib/server/option-contract-code"
import type { ContractGreeks } from "@/lib/server/option-greeks-market"

const PRODUCT_CN: Record<string, string> = {
  NR: "20号胶", TA: "PTA", IM: "中证1000股指", IF: "沪深300股指", IH: "上证50股指",
  IC: "中证500股指", T: "10年期国债", TF: "5年期国债", TS: "2年期国债", TL: "30年期国债",
  AG: "白银", AU: "黄金", CU: "铜", AL: "铝", RB: "螺纹钢", HC: "热卷", I: "铁矿石",
  J: "焦炭", JM: "焦煤", MA: "甲醇", SA: "纯碱", SC: "原油", FU: "燃油", ZN: "锌",
  NI: "镍", SN: "锡", PB: "铅", Y: "豆油", P: "棕榈油", M: "豆粕", A: "豆一", C: "玉米",
  SR: "白糖", CF: "棉花", RM: "菜粕", OI: "菜油", AP: "苹果", CJ: "红枣", LH: "生猪",
  EC: "欧线集运", LC: "碳酸锂", SI: "工业硅", PS: "多晶硅",
}

export type GreekLetterRow = {
  index: number
  variety: string
  delta: number | null
  gamma: number | null
  vega: number | null
  theta: number | null
  rho: number | null
}

export type TermAnalysisRow = {
  index: number
  variety: string
  expiryDate: string | null
  remainingDays: number | null
  multiplier: number | null
  currencyPositionPct: number | null
  marketPct: number | null
}

type HoldingLike = {
  subject_name: string
  symbol: string | null
  asset_class: string | null
  row_kind: string | null
  direction: string | null
  quantity: string | null
  cost: string | null
  signed_cost: string | null
  market_weight: string | null
  signed_market_value: string | null
  market_value: string | null
  extra: Record<string, unknown>
}

function parseNum(v: string | null | undefined): number {
  if (v == null || v === "") return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function normKey(key: string): string {
  return key.replace(/[\s\u3000:：]/g, "").toLowerCase()
}

function pickExtraNumber(extra: Record<string, unknown>, ...needles: string[]): number | null {
  for (const [rawKey, rawVal] of Object.entries(extra)) {
    const key = normKey(rawKey)
    for (const needle of needles) {
      if (key === normKey(needle) || key.includes(normKey(needle))) {
        if (typeof rawVal === "number" && Number.isFinite(rawVal)) return rawVal
        const text = String(rawVal ?? "").replace(/,/g, "").replace(/%/g, "").trim()
        if (!text || text === "—" || text === "-") return null
        const n = Number(text)
        if (Number.isFinite(n)) return n
      }
    }
  }
  return null
}

function pickExtraString(extra: Record<string, unknown>, ...needles: string[]): string | null {
  for (const [rawKey, rawVal] of Object.entries(extra)) {
    const key = normKey(rawKey)
    for (const needle of needles) {
      if (key === normKey(needle) || key.includes(normKey(needle))) {
        const text = String(rawVal ?? "").trim()
        if (text && text !== "—" && text !== "-") return text.slice(0, 10)
      }
    }
  }
  return null
}

export function extractVarietyLabel(h: HoldingLike): string {
  const name = String(h.subject_name ?? "").trim()
  let label = name
    .replace(/[A-Za-z]+\d{3,4}[CPcp]\d+/g, "")
    .replace(/[A-Za-z]+\d{3,4}/g, "")
    .replace(/[-－_].*$/, "")
    .replace(/\s+/g, "")
    .trim()
  if (label.length >= 2) return label

  const root = extractContractRootSymbol(h.symbol, name)
  if (root && PRODUCT_CN[root]) return PRODUCT_CN[root]
  if (h.asset_class === "股指期货") return PRODUCT_CN[root] ?? "股指期货"
  if (h.asset_class === "国债期货") return PRODUCT_CN[root] ?? "国债期货"
  if (h.asset_class === "期权") return PRODUCT_CN[root] ?? "期权"
  return root || name || "其他"
}

function isDerivativeLike(h: HoldingLike): boolean {
  if (h.row_kind === "derivative" || h.row_kind === "option") return true
  if (h.asset_class === "期权") return true
  if (/期权/.test(h.subject_name)) return true
  return /[A-Za-z]{1,4}\d{3,4}/.test(`${h.symbol ?? ""}${h.subject_name}`)
}

function readGreek(h: HoldingLike, field: "delta" | "gamma" | "vega" | "theta" | "rho"): number | null {
  return pickExtraNumber(h.extra, field, field.toUpperCase())
}

function isOptionLike(h: HoldingLike): boolean {
  if (h.row_kind === "option") return true
  if (h.asset_class === "期权") return true
  if (/期权/.test(h.subject_name)) return true
  return /[A-Za-z]{1,6}\d{3,4}[CPcp]\d+/.test(`${h.symbol ?? ""}${h.subject_name}`)
}

function resolveSignedQuantity(h: HoldingLike): number {
  const qty = Math.abs(parseNum(h.quantity))
  if (qty <= 0) return 0
  const signedMv = parseNum(h.signed_market_value) || parseNum(h.market_value)
  const signedCost = parseNum(h.signed_cost) || parseNum(h.cost)
  const name = String(h.subject_name ?? "")
  if (/卖方/.test(name)) return -qty
  if (/买方/.test(name)) return qty
  if (h.direction === "short" || signedMv < 0 || signedCost < 0) return -qty
  return qty
}

function hasDerivativeExposure(h: HoldingLike): boolean {
  const qty = Math.abs(parseNum(h.quantity))
  const mv = Math.abs(parseNum(h.signed_market_value) || parseNum(h.market_value))
  return qty > 0 || mv > 0
}

function inferExpiryFromSymbol(symbol: string | null, subjectName: string): string | null {
  const text = `${symbol ?? ""}${subjectName}`
  const match = text.match(/([A-Za-z]+)(\d{4})(?:[CPcp]\d+)?/)
  if (!match) return null
  const mm = parseInt(match[2].slice(2, 4), 10)
  const yy = parseInt(match[2].slice(0, 2), 10)
  if (mm < 1 || mm > 12) return null
  const year = yy >= 70 ? 1900 + yy : 2000 + yy
  const lastDay = new Date(year, mm, 0).getDate()
  return `${year}-${String(mm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
}

function parseExpiryDate(h: HoldingLike): string | null {
  const fromExtra = pickExtraString(h.extra, "到期日", "expiry_date", "到期日期")
  if (fromExtra && /^\d{4}-\d{2}-\d{2}/.test(fromExtra)) return fromExtra.slice(0, 10)
  return inferExpiryFromSymbol(h.symbol, h.subject_name)
}

function calcRemainingDays(expiry: string | null, valuationDate: string | null): number | null {
  if (!expiry || !valuationDate) return null
  const a = new Date(`${valuationDate.slice(0, 10)}T12:00:00`)
  const b = new Date(`${expiry.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function readMarketPct(h: HoldingLike, netAssetValue: number): number {
  const weightRaw = parseNum(h.market_weight)
  if (weightRaw !== 0) {
    return Math.abs(weightRaw) <= 1 ? weightRaw * 100 : weightRaw
  }
  const mv = Math.abs(parseNum(h.signed_market_value) || parseNum(h.market_value))
  return netAssetValue > 0 ? (mv / netAssetValue) * 100 : 0
}

type GreekBucket = {
  delta: number
  gamma: number
  vega: number
  theta: number
  rho: number
  hasExposure: boolean
}

export function buildGreekLetters(
  holdings: HoldingLike[],
  marketGreeks?: Map<string, ContractGreeks>,
): GreekLetterRow[] {
  const groups = new Map<string, GreekBucket>()

  for (const h of holdings) {
    if (!isDerivativeLike(h) || !hasDerivativeExposure(h)) continue

    const variety = extractVarietyLabel(h)
    const bucket = groups.get(variety) ?? {
      delta: 0,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      hasExposure: false,
    }
    bucket.hasExposure = true

    for (const field of ["delta", "gamma", "vega", "theta", "rho"] as const) {
      const val = readGreek(h, field)
      if (val != null) bucket[field] += val
    }

    if (marketGreeks && isOptionLike(h)) {
      const rawCode = extractOptionContractFromText(h.symbol, h.subject_name)
      const choiceCode = rawCode ? normalizeOptionContractCode(rawCode) : null
      const g = choiceCode ? marketGreeks.get(choiceCode) : null
      if (g) {
        const signedQty = resolveSignedQuantity(h)
        if (signedQty !== 0) {
          bucket.delta += g.delta * signedQty
          bucket.gamma += g.gamma * signedQty
          bucket.vega += g.vega * signedQty
          bucket.theta += g.theta * signedQty
          bucket.rho += g.rho * signedQty
        }
      }
    } else if (!isOptionLike(h)) {
      // Futures: approximate portfolio delta as signed lot count.
      const signedQty = resolveSignedQuantity(h)
      if (signedQty !== 0) bucket.delta += signedQty
    }

    groups.set(variety, bucket)
  }

  return [...groups.entries()]
    .filter(([, v]) => v.hasExposure)
    .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))
    .map(([variety, g], i) => ({
      index: i + 1,
      variety,
      delta: g.delta,
      gamma: g.gamma,
      vega: g.vega,
      theta: g.theta,
      rho: g.rho,
    }))
}

export function buildTermAnalysis(
  holdings: HoldingLike[],
  valuationDate: string | null,
  netAssetValue: number,
): TermAnalysisRow[] {
  type TermBucket = {
    variety: string
    expiryDate: string | null
    remainingDays: number | null
    multiplier: number
    currencyPositionPct: number
    marketPct: number
  }

  const groups = new Map<string, TermBucket>()

  for (const h of holdings) {
    if (!isDerivativeLike(h)) continue

    const variety = extractVarietyLabel(h)
    const expiryDate = parseExpiryDate(h)
    const key = `${variety}|${expiryDate ?? ""}`
    const bucket = groups.get(key) ?? {
      variety,
      expiryDate,
      remainingDays: pickExtraNumber(h.extra, "剩余天数", "remaining_days") ?? calcRemainingDays(expiryDate, valuationDate),
      multiplier: 0,
      currencyPositionPct: 0,
      marketPct: 0,
    }

    bucket.multiplier += Math.abs(parseNum(h.quantity))

    const currencyPct = pickExtraNumber(h.extra, "币种持仓占比", "currency_position_pct")
    const marketPct = readMarketPct(h, netAssetValue)
    bucket.currencyPositionPct += currencyPct ?? marketPct
    bucket.marketPct += marketPct

    if (!bucket.expiryDate && expiryDate) bucket.expiryDate = expiryDate
    if (bucket.remainingDays == null) {
      bucket.remainingDays = pickExtraNumber(h.extra, "剩余天数", "remaining_days")
        ?? calcRemainingDays(bucket.expiryDate, valuationDate)
    }

    groups.set(key, bucket)
  }

  return [...groups.values()]
    .filter((g) => g.multiplier > 0 || g.marketPct > 0)
    .sort((a, b) => b.marketPct - a.marketPct)
    .map((g, i) => ({
      index: i + 1,
      variety: g.variety,
      expiryDate: g.expiryDate,
      remainingDays: g.remainingDays,
      multiplier: g.multiplier > 0 ? g.multiplier : null,
      currencyPositionPct: g.currencyPositionPct !== 0 ? g.currencyPositionPct : null,
      marketPct: g.marketPct !== 0 ? g.marketPct : null,
    }))
}
