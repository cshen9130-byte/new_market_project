/**
 * 穿透合规 — 《私募证券投资基金运作指引》（2024-08-01）
 * Product-type ratios (第41条) + concentration / leverage (第12 / 15 / 19条).
 * FOF holdings are looked through to underlying 估值表 leaves.
 */

import { query } from "@/lib/db"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"
import { ensureEmailValuationHoldingsTables } from "@/lib/server/email-valuation-holdings-pg"
import {
  fundDisplayNamesMatch,
  fundNicknameMatchesFullName,
  shareClassProductCodesMatch,
  sqlFundNameMatch,
} from "@/lib/server/fund-name-match"
import {
  isValuationClearingSubjectCode,
  isValuationIncrementSubjectCode,
} from "@/lib/server/fund-holding-code"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"
import { sqlType6TableResolvedStrategy } from "@/lib/server/fund-strategy-resolve"
import type {
  AssetBucket,
  ComplianceCheck,
  LookthroughComplianceProduct,
  LookthroughComplianceResult,
  LookthroughHolding,
  LookthroughMissing,
  LookthroughSubfundStructure,
  ProductCategory,
} from "@/lib/ma/lookthrough-compliance-types"
import {
  loadLookthroughCategoryByBeian,
  loadLookthroughProductCategories,
} from "@/lib/server/lookthrough-product-categories"

type RawHolding = {
  valuation_record_id: number
  subject_code: string
  subject_name: string
  symbol: string | null
  row_kind: string | null
  asset_class: string | null
  direction: string | null
  market_value: number
  cost: number
  signed_market_value: number
  signed_cost: number
  quantity: number
  price: number
  extra: Record<string, unknown>
}

type ValuationMeta = {
  id: number
  product_code: string | null
  fund_name: string | null
  valuation_date: string
  net_asset_value: number
  total_asset: number
  unit_nav: number | null
}

type ManagedProductRow = {
  id: number
  product_name: string
  beian_hao: string | null
}

function toNum(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const n = Number(String(value).replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

function extraNum(extra: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const n = toNum(extra[key])
    if (n !== 0) return Math.abs(n)
  }
  return 0
}

function holdingNotional(h: RawHolding): number {
  const fromExtra = extraNum(h.extra, [
    "notional_value",
    "合约价值",
    "初始合约价值",
    "名义本金",
    "名义金额",
  ])
  if (fromExtra > 0) return fromExtra
  const qtyPrice = Math.abs(h.quantity * h.price)
  if (qtyPrice > Math.abs(h.market_value) * 3 && qtyPrice > 0) return qtyPrice
  return Math.abs(h.market_value)
}

function displayName(raw: string): string {
  const stripped = stripValuationSubjectPathPrefix(raw) || raw
  return stripped.replace(/^场外[_/.\s]+/u, "").trim() || raw.trim()
}

function isCashToolName(name: string, assetClass: string): boolean {
  const blob = `${name} ${assetClass}`
  return /国债|中央银行票据|央票|政策性金融|国开债|农发债|口行债|进出口行|地方政府债|地方债|货币市场基金|货币型基金|货币基金/.test(blob)
}

function isPublicFund(h: RawHolding): boolean {
  const kind = h.row_kind ?? ""
  if (kind === "money_fund" || kind === "fund") return true
  const code = String(h.subject_code ?? "").replace(/[\s.]/g, "")
  return code.startsWith("1105")
}

function isPrivateFundHolding(h: RawHolding): boolean {
  if (isValuationClearingSubjectCode(h.subject_code) || isValuationIncrementSubjectCode(h.subject_code)) {
    return false
  }
  const kind = h.row_kind ?? ""
  if (kind === "private_fund") return true
  const code = String(h.subject_code ?? "").replace(/[\s.]/g, "")
  if (code.startsWith("1108") || code.startsWith("1109")) return true
  const name = h.subject_name ?? ""
  if (/^银行存款|^结算备付金|^存出保证金/.test(name)) return false
  return /私募证券投资基金|私募基金/.test(name) && kind !== "stock" && kind !== "bond"
}

function extraText(extra: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = extra[key]
    if (v != null && String(v).trim()) return String(v)
  }
  return ""
}

function isLiquidityRestrictedHolding(h: RawHolding): boolean {
  if (isPrivateFundHolding(h)) return true
  const name = `${h.subject_name ?? ""} ${h.asset_class ?? ""}`
  const suspension = extraText(h.extra, ["suspension_info", "停牌信息", "限售信息", "流通受限"])
  const blob = `${name} ${suspension}`
  if (/限售|流通受限|非公开发行|未上市|锁定/.test(blob)) return true
  if (/停牌/.test(blob) && !/正常交易/.test(blob)) return true
  return false
}

const BOND_RATING_RE = /(AAA|AA\+|AA＋|AA-|AA－|AA|A\+|A＋|A-|A－|A|BBB\+|BBB＋|BBB-|BBB－|BBB|BB\+|BB-|BB|B\+|B-|B|CCC|CC|C|D)(?![A-Za-z+＋])/

const BOND_RATING_RANK: Record<string, number> = {
  AAA: 1,
  "AA+": 2,
  AA: 3,
  "AA-": 4,
  "A+": 5,
  A: 6,
  "A-": 7,
  "BBB+": 8,
  BBB: 9,
  "BBB-": 10,
  "BB+": 11,
  BB: 12,
  "BB-": 13,
  "B+": 14,
  B: 15,
  "B-": 16,
  CCC: 17,
  CC: 18,
  C: 19,
  D: 20,
}

function parseBondRating(h: RawHolding): string | null {
  const blob = [
    extraText(h.extra, ["评级", "债项评级", "主体评级", "credit_rating", "bond_rating", "rating"]),
    h.subject_name ?? "",
    h.asset_class ?? "",
  ].join(" ")
  const m = blob.toUpperCase().replace(/＋/g, "+").replace(/－/g, "-").match(BOND_RATING_RE)
  return m ? m[1].replace(/＋/g, "+").replace(/－/g, "-") : null
}

/** 第15条第二款：AA 级及以下信用债（可转债除外）。 */
function isAaOrBelowCreditBond(h: RawHolding): boolean {
  const name = h.subject_name ?? ""
  if (/可转债|可交换债/.test(name)) return false
  const kind = h.row_kind ?? ""
  const code = String(h.subject_code ?? "").replace(/[\s.]/g, "")
  if (kind !== "bond" && !code.startsWith("1101")) return false
  const rating = parseBondRating(h)
  if (!rating) return false
  const rank = BOND_RATING_RANK[rating]
  return rank != null && rank >= 3
}

function article15RestrictedMv(holdings: RawHolding[]): number {
  let total = 0
  for (const h of holdings) {
    const mv = Math.abs(h.market_value)
    if (mv <= 0) continue
    if (isLiquidityRestrictedHolding(h) || isAaOrBelowCreditBond(h)) total += mv
  }
  return total
}

function isDerivativeHolding(h: RawHolding): boolean {
  const kind = h.row_kind ?? ""
  if (kind === "derivative" || kind === "option") return true
  const code = String(h.subject_code ?? "").replace(/[\s.]/g, "")
  if (code.startsWith("3102")) return true
  const name = h.subject_name ?? ""
  if (/备付金|保证金|银行存款/.test(name)) return false
  return /期货|期权|收益互换|收益凭证|远期合约|场外期权/.test(name)
}

function classifyBucket(h: RawHolding): AssetBucket {
  const kind = h.row_kind ?? "other"
  const name = h.subject_name ?? ""
  const assetClass = h.asset_class ?? ""
  const code = String(h.subject_code ?? "").replace(/[\s.]/g, "")

  if (kind === "bank_deposit" || code.startsWith("1002")) return "cash_tool"
  if (kind === "money_fund" || /货币基金|货币型/.test(name)) return "cash_tool"
  if ((kind === "bond" || code.startsWith("1101")) && isCashToolName(name, assetClass)) return "cash_tool"

  if (isDerivativeHolding(h)) return "derivatives"

  if (kind === "stock" || code.startsWith("1001")) return "equity"
  if (/可转债|可交换债/.test(name)) return "equity"

  if (kind === "fund" || kind === "fund_or_stock" || code.startsWith("1105") || code.startsWith("1102")) {
    if (/货币/.test(name)) return "cash_tool"
    if (/债券|固收|短债/.test(name)) return "fixed_income"
    if (/股票|混合|指数|ETF|权益/.test(name)) return "equity"
    return "fund"
  }

  if (isPrivateFundHolding(h)) return "fund"

  if (kind === "bond" || kind === "repo" || code.startsWith("1101") || code.startsWith("1202")) {
    return "fixed_income"
  }

  if (kind === "margin_deposit" || kind === "settlement_reserve") return "margin"

  if (
    kind === "receivable"
    || kind === "payable"
    || kind === "clearing"
    || kind === "paid_in_capital"
  ) {
    return "other"
  }

  return "other"
}

function isGeneralPledgedRepo(h: RawHolding): boolean {
  const kind = h.row_kind ?? ""
  if (kind === "repo") return true
  const code = String(h.subject_code ?? "").replace(/[\s.]/g, "")
  if (code.startsWith("1202")) return true
  const name = h.subject_name ?? ""
  if (/协议回购/.test(name)) return false
  return /质押式回购|买断式回购|债券回购|逆回购|正回购/.test(name)
}

function isArticle19ExemptName(h: RawHolding): boolean {
  const blob = `${h.subject_name ?? ""} ${h.asset_class ?? ""}`
  if (/可转债|可交换债/.test(blob)) return true
  if (isCashToolName(blob, h.asset_class ?? "")) return true
  return isGeneralPledgedRepo(h)
}

function isClearingLikeHolding(h: RawHolding): boolean {
  const kind = h.row_kind ?? ""
  if (
    kind === "margin_deposit"
    || kind === "settlement_reserve"
    || kind === "bank_deposit"
    || kind === "receivable"
    || kind === "payable"
    || kind === "clearing"
    || kind === "paid_in_capital"
  ) {
    return true
  }
  return /^(银行存款|结算备付金|存出保证金)/.test(h.subject_name ?? "")
}

function isConcentrationExempt(h: RawHolding, bucket: AssetBucket): boolean {
  if (bucket === "cash_tool") return true
  if (isClearingLikeHolding(h)) return true
  if (isPublicFund(h)) return true
  if (isGeneralPledgedRepo(h)) return true
  return false
}

function holdingSign(h: RawHolding): 1 | -1 {
  if (h.signed_market_value < 0 || h.signed_cost < 0) return -1
  const direction = String(h.direction ?? "").toLowerCase()
  if (direction === "short" || direction === "sell" || h.quantity < 0) return -1
  return 1
}

function isBondLike(h: RawHolding, bucket: AssetBucket): boolean {
  if (isArticle19ExemptName(h)) return false
  if (bucket !== "fixed_income" && !/可转债|可交换债/.test(h.subject_name ?? "")) return false
  const kind = h.row_kind ?? ""
  const code = String(h.subject_code ?? "").replace(/[\s.]/g, "")
  return kind === "bond" || code.startsWith("1101") || /债/.test(h.subject_name ?? "")
}

function sameAssetKey(h: RawHolding, bucket: AssetBucket): string {
  const symbol = String(h.symbol ?? "").trim().toUpperCase()
  const name = displayName(h.subject_name)
  if (symbol && /^[A-Z0-9]{4,}$/.test(symbol)) return `${bucket}:${symbol}`
  return `${bucket}:${name || symbol || h.subject_code}`
}

function fmtPct(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toFixed(digits)}%`
}

function ratio(num: number, den: number): number | null {
  if (!(den > 0)) return null
  return (num / den) * 100
}

function inferType(args: {
  equityPct: number | null
  fiPct: number | null
  derivNotionalPct: number | null
  derivEquityPct: number | null
  fundPct: number | null
}): ProductCategory | "母基金" | "无法判定" {
  const { equityPct, fiPct, derivNotionalPct, derivEquityPct, fundPct } = args
  if (equityPct == null && fiPct == null && derivNotionalPct == null) return "无法判定"
  if ((fundPct ?? 0) >= 80) return "母基金"
  if ((equityPct ?? 0) >= 80) return "权益类"
  if ((fiPct ?? 0) >= 80) return "固定收益类"
  if ((derivNotionalPct ?? 0) >= 80 && (derivEquityPct ?? 0) > 20) return "期货和衍生品类"
  return "混合类"
}

function buildChecks(
  category: ProductCategory,
  p: {
    equityPct: number | null
    fiPct: number | null
    derivNotionalPct: number | null
    derivEquityPct: number | null
    leveragePct: number | null
    leverageLimitPct: number
    illiquidPct: number | null
    maxSinglePct: number | null
    maxBondPct: number | null
    maxSingleName: string | null
    maxBondName: string | null
    bondExemptNote?: string | null
    lookthroughComplete: boolean
    lookthroughAttempted: boolean
    missing: LookthroughMissing[]
    hasValuation: boolean
  },
): ComplianceCheck[] {
  const checks: ComplianceCheck[] = []

  if (!p.hasValuation) {
    checks.push({
      id: "valuation",
      title: "估值表",
      article: "数据",
      passed: false,
      value: "无",
      threshold: "需有最新估值表",
      detail: "该在管产品尚未匹配到估值表，无法判定持仓比例。",
    })
    return checks
  }

  if (category === "权益类") {
    const ok = (p.equityPct ?? 0) >= 80
    checks.push({
      id: "type-equity",
      title: "权益类资产占比",
      article: "第41条",
      passed: ok,
      value: fmtPct(p.equityPct),
      threshold: "≥ 已投资产 80%",
      detail: ok
        ? "权益类资产达到权益类产品认定标准。"
        : "权益类资产未达到已投资产的 80%，不符合权益类认定。",
    })
  } else if (category === "固定收益类") {
    const ok = (p.fiPct ?? 0) >= 80
    checks.push({
      id: "type-fi",
      title: "债权类资产占比",
      article: "第41条",
      passed: ok,
      value: fmtPct(p.fiPct),
      threshold: "≥ 已投资产 80%",
      detail: ok
        ? "债权类资产达到固定收益类产品认定标准。"
        : "债权类资产未达到已投资产的 80%，不符合固定收益类认定。",
    })
  } else if (category === "期货和衍生品类") {
    const notionalOk = (p.derivNotionalPct ?? 0) >= 80
    const equityOk = (p.derivEquityPct ?? 0) > 20
    checks.push({
      id: "type-deriv-notional",
      title: "期货和衍生品合约价值",
      article: "第41条",
      passed: notionalOk,
      value: fmtPct(p.derivNotionalPct),
      threshold: "≥ 已投资产 80%",
      detail: notionalOk
        ? "衍生品持仓合约价值达到认定标准。已投资产 = 权益市值 + 固收市值 + 期货合约价值 + 其他已投，不含现金管理工具。"
        : "衍生品持仓合约价值未达到已投资产的 80%。已投资产按期货合约价值加其他已投、不含现金管理工具。",
    })
    checks.push({
      id: "type-deriv-equity",
      title: "期货和衍生品账户权益",
      article: "第41条",
      passed: equityOk,
      value: fmtPct(p.derivEquityPct),
      threshold: "> 市值已投资产 20%",
      detail: equityOk
        ? "期货和衍生品账户权益（保证金+结算备付金）超过市值口径已投资产的 20%。该口径不含现金管理工具，也不把合约价值计入分母。"
        : "期货和衍生品账户权益未超过市值口径已投资产的 20%。",
    })
  } else {
    const isEquity = (p.equityPct ?? 0) >= 80
    const isFi = (p.fiPct ?? 0) >= 80
    const isDeriv = (p.derivNotionalPct ?? 0) >= 80 && (p.derivEquityPct ?? 0) > 20
    const ok = !isEquity && !isFi && !isDeriv
    const crossed = [
      isEquity ? "权益类≥80%" : null,
      isFi ? "固定收益类≥80%" : null,
      isDeriv ? "期货和衍生品类达标" : null,
    ].filter(Boolean).join("、")
    checks.push({
      id: "type-mixed",
      title: "混合类认定",
      article: "第41条",
      passed: ok,
      value: ok ? "未越界" : crossed,
      threshold: "权益/固收/衍生品均未达专类标准",
      detail: ok
        ? "三类资产均未达到 80% 专类标准，符合混合类。"
        : `当前持仓已达到专类标准（${crossed}），与混合类约定不符。`,
    })
  }

  const concOk = p.maxSinglePct == null || p.maxSinglePct <= 25 + 1e-6
  checks.push({
    id: "conc-25",
    title: "单一资产集中度",
    article: "第12条",
    passed: concOk,
    value: p.maxSingleName
      ? `${p.maxSingleName} ${fmtPct(p.maxSinglePct)}`
      : fmtPct(p.maxSinglePct),
    threshold: "≤ 净资产 25%",
    detail: concOk
      ? "穿透后单一资产（现金管理工具、公募基金除外）未超过净资产 25%。"
      : `穿透后「${p.maxSingleName ?? "单一资产"}」占净资产 ${fmtPct(p.maxSinglePct)}，超过 25%。`,
  })

  const bondHasInScope = p.maxBondName != null
  const bondOk = p.maxBondPct == null || p.maxBondPct <= 10 + 1e-6
  const bondValue = p.maxBondPct == null
    ? "—"
    : bondHasInScope
      ? `${p.maxBondName} ${fmtPct(p.maxBondPct)}`
      : `无适用债券 ${fmtPct(0)}`
  const bondDetail = p.maxBondPct == null
    ? "缺少净资产，无法按第19条计算单一债券占净值。"
    : [
      bondHasInScope
        ? (bondOk
          ? `最大适用债券「${p.maxBondName}」占净资产 ${fmtPct(p.maxBondPct)}，未超过 10%。`
          : `「${p.maxBondName}」占净资产 ${fmtPct(p.maxBondPct)}，超过 10%。`)
        : "第19条按「同一债券」占净资产计。穿透后没有适用的信用债/同一债券，集中度为 0%，未触发 10% 上限。",
      p.bondExemptNote ? `不按同一债券计：${p.bondExemptNote}。` : "国债、央票、政金债、地方债、可转债、可交换债、债券通用质押式回购除外。",
      p.lookthroughAttempted && !p.lookthroughComplete
        ? `有 ${p.missing.length} 只底层未穿透，其内部债券未拆入本项，当前仅按已拆持仓判断。`
        : "",
    ].filter(Boolean).join(" ")
  checks.push({
    id: "bond-10",
    title: "单一债券集中度",
    article: "第19条",
    passed: bondOk,
    value: bondValue,
    threshold: "≤ 净资产 10%",
    detail: bondDetail,
  })

  const levLimit = p.leverageLimitPct
  const levOk = p.leveragePct == null || p.leveragePct <= levLimit + 1e-6
  const illiquidText = p.illiquidPct == null ? "—" : fmtPct(p.illiquidPct)
  checks.push({
    id: "leverage",
    title: "总资产杠杆",
    article: "第15条",
    passed: levOk,
    value: fmtPct(p.leveragePct),
    threshold: `≤ 净资产 ${levLimit}%`,
    detail: levLimit === 120
      ? (levOk
        ? `私募基金份额计入流动性受限资产，与 AA 级及以下信用债合计占净资产 ${illiquidText}，超过 20%，适用第15条第二款：总资产不得超过净资产 120%。当前未超限。封闭且投资者均为专业投资者、单笔实缴≥1000万元的除外（本页未核验该豁免）。`
        : `私募基金份额计入流动性受限资产，与 AA 级及以下信用债合计占净资产 ${illiquidText}，超过 20%，总资产/净资产 ${fmtPct(p.leveragePct)}，超过 120% 上限。`)
      : (levOk
        ? `流动性受限资产与 AA 级及以下信用债合计占净资产 ${illiquidText}，未超过 20%，适用第15条第一款：总资产不得超过净资产 200%。`
        : `总资产/净资产为 ${fmtPct(p.leveragePct)}，超过 200% 杠杆上限。`),
  })

  if (p.lookthroughAttempted && !p.lookthroughComplete) {
    const names = p.missing.slice(0, 4).map((m) => m.name).join("、")
    checks.push({
      id: "lookthrough",
      title: "FOF 估值表穿透",
      article: "第14条",
      passed: false,
      value: `${p.missing.length} 只未穿透`,
      threshold: "底层须有估值表",
      detail: `以下底层缺少估值表，集中度与类别按未穿透份额计：${names}${p.missing.length > 4 ? "…" : ""}`,
    })
  }

  return checks
}

function codesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? "").trim().toUpperCase()
  const y = String(b ?? "").trim().toUpperCase()
  if (!x || !y) return false
  return x === y || shareClassProductCodesMatch(x, y)
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = displayName(String(a ?? ""))
  const y = displayName(String(b ?? ""))
  if (!x || !y) return false
  return fundDisplayNamesMatch(x, y) || fundNicknameMatchesFullName(x, y) || fundNicknameMatchesFullName(y, x)
}

function holdingLookupCode(h: RawHolding): string | null {
  const symbol = (h.symbol ?? "").trim()
  if (symbol) return symbol
  const fromSubject = String(h.subject_code ?? "").match(/[A-Z0-9]{5,}$/i)?.[0]
  return fromSubject ? fromSubject.trim() : null
}

function findUnderlyingMeta(
  holding: RawHolding,
  catalog: ValuationMeta[],
  self: { product_code: string | null; fund_name: string | null; record_id?: number },
): ValuationMeta | null {
  const code = holding.symbol
    || String(holding.subject_code ?? "").match(/[A-Z0-9]{5,}$/i)?.[0]
    || null
  const name = displayName(holding.subject_name)
  const scored: Array<{ meta: ValuationMeta; score: number }> = []
  for (const meta of catalog) {
    if (isSameFundAsParent(meta, self)) continue
    let score = 0
    if (code && codesMatch(meta.product_code, code)) score += 4
    if (name && namesMatch(meta.fund_name, name)) score += 3
    if (code && namesMatch(meta.fund_name, name) && codesMatch(meta.product_code, code)) score += 2
    if (score > 0) scored.push({ meta, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.meta ?? null
}

/** Skip the parent FOF's own 估值表. Do not skip by fund_name alone:
 *  TA/托管邮件常把底层产品代码写成 SBVC85，同时 fund_name 填成上层 FOF 名称。 */
function isSameFundAsParent(
  meta: ValuationMeta,
  self: { product_code: string | null; fund_name: string | null; record_id?: number },
): boolean {
  if (self.record_id && meta.id === self.record_id) return true
  if (codesMatch(meta.product_code, self.product_code)) return true
  if (!meta.product_code && namesMatch(meta.fund_name, self.fund_name)) return true
  return false
}

function isExcludedNonFof(productName: string): boolean {
  return /恒盈2号/.test(productName)
}

async function loadManagedProducts(): Promise<ManagedProductRow[]> {
  return query<ManagedProductRow>(
    `SELECT
       m.id::int AS id,
       m.product_name,
       NULLIF(BTRIM(COALESCE(cache.beian_hao, '')), '') AS beian_hao
     FROM managed_products m
     LEFT JOIN ops_managed_products_list_cache cache
       ON cache.managed_product_id = m.id
     WHERE m.product_name <> '合计'
     ORDER BY m.sequence_no NULLS LAST, m.id`,
  )
}

async function loadLatestValuationsForManaged(
  products: ManagedProductRow[],
): Promise<Map<number, ValuationMeta>> {
  if (products.length === 0) return new Map()
  const ids = products.map((p) => p.id)
  const rows = await query<{
    managed_product_id: number
    id: string
    product_code: string | null
    fund_name: string | null
    valuation_date: string
    net_asset_value: string | null
    net_asset: string | null
    total_asset: string | null
    total_liability: string | null
    unit_nav: string | null
  }>(
    `SELECT DISTINCT ON (m.id)
       m.id AS managed_product_id,
       r.id::text,
       r.product_code,
       r.fund_name,
       r.valuation_date::text,
       r.net_asset_value::text,
       r.net_asset::text,
       r.total_asset::text,
       r.total_liability::text,
       r.unit_nav::text
     FROM managed_products m
     LEFT JOIN ops_managed_products_list_cache cache
       ON cache.managed_product_id = m.id
     INNER JOIN ops_email_valuation_records r
       ON (
         (
           NULLIF(BTRIM(r.product_code), '') IS NOT NULL
           AND NULLIF(BTRIM(cache.beian_hao), '') IS NOT NULL
           AND (
             UPPER(BTRIM(r.product_code)) = UPPER(BTRIM(cache.beian_hao))
             OR regexp_replace(UPPER(BTRIM(r.product_code)), '[ABC]$', '')
                = regexp_replace(UPPER(BTRIM(cache.beian_hao)), '[ABC]$', '')
           )
         )
         OR ${sqlFundNameMatch("r.fund_name", "m.product_name")}
       )
     WHERE m.id = ANY($1::bigint[])
     ORDER BY m.id, r.valuation_date DESC, r.id DESC`,
    [ids],
  )

  const map = new Map<number, ValuationMeta>()
  for (const row of rows) {
    const nav = toNum(row.net_asset_value) || toNum(row.net_asset)
    const totalAsset = toNum(row.total_asset)
      || (nav > 0 && toNum(row.total_liability) >= 0 ? nav + toNum(row.total_liability) : nav)
    map.set(Number(row.managed_product_id), {
      id: Number(row.id),
      product_code: row.product_code,
      fund_name: row.fund_name,
      valuation_date: row.valuation_date,
      net_asset_value: nav,
      total_asset: totalAsset,
      unit_nav: toNum(row.unit_nav) || null,
    })
  }
  return map
}

async function loadHoldingsByRecordIds(recordIds: number[]): Promise<Map<number, RawHolding[]>> {
  const map = new Map<number, RawHolding[]>()
  if (recordIds.length === 0) return map
  const rows = await query<{
    valuation_record_id: string
    subject_code: string
    subject_name: string
    symbol: string | null
    row_kind: string | null
    asset_class: string | null
    direction: string | null
    market_value: string | null
    cost: string | null
    signed_market_value: string | null
    signed_cost: string | null
    quantity: string | null
    price: string | null
    extra: Record<string, unknown> | null
  }>(
    `SELECT
       valuation_record_id::text,
       subject_code,
       subject_name,
       symbol,
       row_kind,
       asset_class,
       direction,
       market_value::text,
       cost::text,
       signed_market_value::text,
       signed_cost::text,
       quantity::text,
       price::text,
       extra
     FROM ops_email_valuation_holdings
     WHERE valuation_record_id = ANY($1::bigint[])
       AND include_in_detail = TRUE`,
    [recordIds],
  )

  for (const row of rows) {
    const recordId = Number(row.valuation_record_id)
    if (isValuationClearingSubjectCode(row.subject_code) || isValuationIncrementSubjectCode(row.subject_code)) {
      continue
    }
    const holding: RawHolding = {
      valuation_record_id: recordId,
      subject_code: row.subject_code,
      subject_name: row.subject_name,
      symbol: row.symbol,
      row_kind: row.row_kind,
      asset_class: row.asset_class,
      direction: row.direction,
      market_value: toNum(row.market_value),
      cost: toNum(row.cost),
      signed_market_value: toNum(row.signed_market_value),
      signed_cost: toNum(row.signed_cost),
      quantity: toNum(row.quantity),
      price: toNum(row.price),
      extra: row.extra ?? {},
    }
    const list = map.get(recordId) ?? []
    list.push(holding)
    map.set(recordId, list)
  }
  return map
}

async function loadLatestValuationCatalog(): Promise<ValuationMeta[]> {
  const rows = await query<{
    id: string
    product_code: string | null
    fund_name: string | null
    valuation_date: string
    net_asset_value: string | null
    net_asset: string | null
    total_asset: string | null
    total_liability: string | null
    unit_nav: string | null
  }>(
    `SELECT DISTINCT ON (fund_key)
       id::text,
       product_code,
       fund_name,
       valuation_date::text,
       net_asset_value::text,
       net_asset::text,
       total_asset::text,
       total_liability::text,
       unit_nav::text
     FROM (
       SELECT
         id,
         product_code,
         fund_name,
         valuation_date,
         net_asset_value,
         net_asset,
         total_asset,
         total_liability,
         unit_nav,
         COALESCE(NULLIF(TRIM(product_code), ''), NULLIF(TRIM(fund_name), '')) AS fund_key
       FROM ops_email_valuation_records
     ) src
     WHERE fund_key IS NOT NULL
     ORDER BY fund_key, valuation_date DESC, id DESC`,
  )

  return rows.map((row) => {
    const nav = toNum(row.net_asset_value) || toNum(row.net_asset)
    const totalAsset = toNum(row.total_asset)
      || (nav > 0 && toNum(row.total_liability) >= 0 ? nav + toNum(row.total_liability) : nav)
    return {
      id: Number(row.id),
      product_code: row.product_code,
      fund_name: row.fund_name,
      valuation_date: row.valuation_date,
      net_asset_value: nav,
      total_asset: totalAsset,
      unit_nav: toNum(row.unit_nav) || null,
    }
  })
}

type Flattened = {
  holding: RawHolding
  market_value: number
  source_fund: string | null
  source_valuation_date: string | null
  source_product_code: string | null
}

function resolveLookthroughNav(meta: ValuationMeta, childHoldings: RawHolding[] | null | undefined): number {
  if (meta.net_asset_value > 0) return meta.net_asset_value
  if (!childHoldings || childHoldings.length === 0) return 0
  let assets = 0
  let liabilities = 0
  for (const h of childHoldings) {
    const kind = h.row_kind ?? ""
    const mv = Math.abs(h.market_value)
    if (mv <= 0 || isDerivativeHolding(h)) continue
    if (kind === "payable") liabilities += mv
    else if (kind !== "paid_in_capital" && kind !== "clearing") assets += mv
  }
  const derived = assets - liabilities
  return derived > 1000 ? derived : 0
}

function flattenHoldings(
  holdings: RawHolding[],
  catalog: ValuationMeta[],
  holdingsByRecord: Map<number, RawHolding[]>,
  self: { product_code: string | null; fund_name: string | null; record_id?: number },
  lookthrough: boolean,
): { rows: Flattened[]; missing: LookthroughMissing[]; underlyingCount: number; penetrated: number } {
  const rows: Flattened[] = []
  const missing: LookthroughMissing[] = []
  let underlyingCount = 0
  let penetrated = 0

  for (const h of holdings) {
    const mv = Math.abs(h.market_value)
    if (mv <= 0 && Math.abs(h.cost) <= 0) continue

    if (lookthrough && isPrivateFundHolding(h) && mv > 0) {
      underlyingCount += 1
      const meta = findUnderlyingMeta(h, catalog, self)
      const childHoldings = meta ? holdingsByRecord.get(meta.id) : null
      const childNav = meta ? resolveLookthroughNav(meta, childHoldings) : 0
      if (!meta || !childHoldings || !(childNav > 0)) {
        missing.push({
          name: displayName(h.subject_name),
          code: h.symbol,
          market_value: mv,
        })
        rows.push({
          holding: h,
          market_value: mv,
          source_fund: null,
          source_valuation_date: null,
          source_product_code: holdingLookupCode(h),
        })
        continue
      }
      const scale = mv / childNav
      let added = 0
      for (const child of childHoldings) {
        const scaledExtra: Record<string, unknown> = { ...child.extra }
        for (const key of ["notional_value", "合约价值", "初始合约价值", "名义本金", "名义金额"]) {
          if (scaledExtra[key] != null) scaledExtra[key] = toNum(scaledExtra[key]) * scale
        }
        const scaled: RawHolding = {
          ...child,
          market_value: child.market_value * scale,
          cost: child.cost * scale,
          signed_market_value: child.signed_market_value * scale,
          signed_cost: child.signed_cost * scale,
          quantity: child.quantity * scale,
          extra: scaledExtra,
        }
        const childMv = Math.abs(scaled.market_value)
        if (childMv <= 0 && !isDerivativeHolding(child)) continue
        rows.push({
          holding: scaled,
          market_value: isDerivativeHolding(child) ? holdingNotional(scaled) : childMv,
          source_fund: displayName(h.subject_name),
          source_valuation_date: meta.valuation_date || null,
          source_product_code: (meta.product_code || holdingLookupCode(h) || "").trim() || null,
        })
        added += 1
      }
      if (added === 0) {
        missing.push({
          name: displayName(h.subject_name),
          code: h.symbol,
          market_value: mv,
        })
        rows.push({
          holding: h,
          market_value: mv,
          source_fund: null,
          source_valuation_date: null,
          source_product_code: holdingLookupCode(h),
        })
      } else {
        penetrated += 1
      }
      continue
    }

    rows.push({
      holding: h,
      market_value: isDerivativeHolding(h) ? holdingNotional(h) : mv,
      source_fund: null,
      source_valuation_date: null,
      source_product_code: null,
    })
  }

  return { rows, missing, underlyingCount, penetrated }
}

function evaluateProduct(
  product: ManagedProductRow,
  meta: ValuationMeta | undefined,
  holdings: RawHolding[],
  catalog: ValuationMeta[],
  holdingsByRecord: Map<number, RawHolding[]>,
  opts?: { maxHoldings?: number | null },
): LookthroughComplianceProduct {
  const hasValuation = Boolean(meta)
  const lookthrough = Boolean(meta) && !isExcludedNonFof(product.product_name)
  const flat = meta
    ? flattenHoldings(
      holdings,
      catalog,
      holdingsByRecord,
      {
        product_code: meta.product_code,
        fund_name: meta.fund_name,
        record_id: meta.id,
      },
      lookthrough,
    )
    : { rows: [] as Flattened[], missing: [] as LookthroughMissing[], underlyingCount: 0, penetrated: 0 }

  const nav = meta?.net_asset_value ?? 0
  const totalAsset = meta?.total_asset ?? 0

  let equity = 0
  let fixedIncome = 0
  let derivNotional = 0
  let derivEquity = 0
  let cashTools = 0
  let funds = 0
  let other = 0

  const conc = new Map<string, {
    name: string
    value: number
    signedNotional: number
    grossNotional: number
    exempt: boolean
    bond: boolean
    derivative: boolean
  }>()

  const topHoldings: LookthroughHolding[] = []
  type SubAcc = {
    name: string
    product_code: string | null
    is_parent_direct: boolean
    unpenetrated: boolean
    valuation_date: string | null
    equity: number
    fixed_income: number
    derivatives_notional: number
    derivatives_equity: number
    cash_tools: number
    funds_unpenetrated: number
    other: number
  }
  const PARENT_DIRECT = "母基金直投"
  const bySubfund = new Map<string, SubAcc>()
  const missingNames = new Set(flat.missing.map((m) => m.name))
  const bondExemptMv = new Map<string, number>()

  function subfundOf(row: Flattened): SubAcc {
    const isUnpenetratedPrivate = !row.source_fund && isPrivateFundHolding(row.holding)
    const name = row.source_fund
      || (isUnpenetratedPrivate ? displayName(row.holding.subject_name) : PARENT_DIRECT)
    const date = row.source_valuation_date
      || (name === PARENT_DIRECT ? (meta?.valuation_date ?? null) : null)
    const product_code = row.source_product_code
      || (isUnpenetratedPrivate ? holdingLookupCode(row.holding) : null)
      || (name === PARENT_DIRECT ? (meta?.product_code ?? null) : null)
    let acc = bySubfund.get(name)
    if (!acc) {
      acc = {
        name,
        product_code,
        is_parent_direct: name === PARENT_DIRECT,
        unpenetrated: missingNames.has(name) || isUnpenetratedPrivate,
        valuation_date: date,
        equity: 0,
        fixed_income: 0,
        derivatives_notional: 0,
        derivatives_equity: 0,
        cash_tools: 0,
        funds_unpenetrated: 0,
        other: 0,
      }
      bySubfund.set(name, acc)
    } else {
      if (!acc.valuation_date && date) acc.valuation_date = date
      if (!acc.product_code && product_code) acc.product_code = product_code
    }
    return acc
  }

  for (const row of flat.rows) {
    const bucket = classifyBucket(row.holding)
    const kind = row.holding.row_kind ?? ""
    const absMv = Math.abs(row.holding.market_value)
    const sub = subfundOf(row)
    if (
      isGeneralPledgedRepo(row.holding)
      || isArticle19ExemptName(row.holding)
    ) {
      if (
        bucket === "fixed_income"
        || bucket === "cash_tool"
        || /债|回购/.test(row.holding.subject_name ?? "")
      ) {
        const exemptName = displayName(row.holding.subject_name)
        bondExemptMv.set(exemptName, (bondExemptMv.get(exemptName) ?? 0) + absMv)
      }
    }

    if (bucket === "equity") {
      equity += absMv
      sub.equity += absMv
    } else if (bucket === "fixed_income") {
      fixedIncome += absMv
      sub.fixed_income += absMv
    } else if (bucket === "derivatives") {
      const notional = holdingNotional(row.holding)
      derivNotional += notional
      sub.derivatives_notional += notional
    } else if (bucket === "cash_tool") {
      cashTools += absMv
      sub.cash_tools += absMv
    } else if (bucket === "fund") {
      funds += absMv
      sub.funds_unpenetrated += absMv
    } else if (bucket === "margin") {
      // 保证金/备付金计入期货账户权益，不计入已投资产/其他
    } else if (
      kind !== "receivable"
      && kind !== "payable"
      && kind !== "clearing"
      && kind !== "paid_in_capital"
    ) {
      other += absMv
      sub.other += absMv
    }

    if (kind === "margin_deposit" || kind === "settlement_reserve") {
      derivEquity += absMv
      sub.derivatives_equity += absMv
    }

    const exempt = isConcentrationExempt(row.holding, bucket)
    const bond = isBondLike(row.holding, bucket)
    const name = displayName(row.holding.subject_name)
    const key = sameAssetKey(row.holding, bucket)
    const prev = conc.get(key) ?? {
      name,
      value: 0,
      signedNotional: 0,
      grossNotional: 0,
      exempt,
      bond,
      derivative: bucket === "derivatives",
    }
    prev.exempt = prev.exempt && exempt
    prev.bond = prev.bond || bond
    if (bucket === "derivatives") {
      const notional = holdingNotional(row.holding)
      prev.derivative = true
      prev.grossNotional += notional
      prev.signedNotional += notional * holdingSign(row.holding)
    } else if (!exempt) {
      const concValue = Math.abs(row.holding.cost) > 0
        ? Math.min(Math.abs(row.holding.cost), Math.abs(row.holding.market_value) || Math.abs(row.holding.cost))
        : Math.abs(row.holding.market_value)
      prev.value += concValue
    }
    conc.set(key, prev)

    const skipFromHoldings =
      kind === "receivable"
      || kind === "payable"
      || kind === "clearing"
      || kind === "paid_in_capital"
    const displayMv = bucket === "derivatives" ? holdingNotional(row.holding) : absMv
    if (!skipFromHoldings && displayMv > 0) {
      topHoldings.push({
        name: displayName(row.holding.subject_name),
        symbol: row.holding.symbol,
        bucket,
        market_value: displayMv,
        pct_nav: nav > 0 ? (displayMv / nav) * 100 : 0,
        source_fund: row.source_fund,
        concentration_exempt: isConcentrationExempt(row.holding, bucket),
      })
    }
  }

  const invested = equity + fixedIncome + derivNotional + funds + other
  const investedMv = equity + fixedIncome + derivEquity + funds + other
  if (derivNotional > 0 && derivEquity > 0) {
    for (const item of conc.values()) {
      if (!item.derivative) continue
      item.value = derivEquity * (Math.abs(item.signedNotional) / derivNotional)
    }
  }
  const subfund_structures: LookthroughSubfundStructure[] = [...bySubfund.values()]
    .map((acc) => {
      const subInvested = acc.equity + acc.fixed_income + acc.derivatives_notional + acc.funds_unpenetrated + acc.other
      return {
        name: acc.name,
        product_code: acc.product_code,
        is_parent_direct: acc.is_parent_direct,
        unpenetrated: acc.unpenetrated,
        valuation_date: acc.valuation_date,
        fund_strategy: null,
        buckets: {
          equity: acc.equity,
          fixed_income: acc.fixed_income,
          derivatives_notional: acc.derivatives_notional,
          cash_tools: acc.cash_tools,
          funds_unpenetrated: acc.funds_unpenetrated,
          other: acc.other,
          invested_assets: subInvested,
        },
        ratios: {
          equity_pct: ratio(acc.equity, subInvested),
          fixed_income_pct: ratio(acc.fixed_income, subInvested),
          derivatives_notional_pct: ratio(acc.derivatives_notional, subInvested),
          funds_unpenetrated_pct: ratio(acc.funds_unpenetrated, subInvested),
          cash_tools_pct: ratio(acc.cash_tools, subInvested),
          other_pct: ratio(acc.other, subInvested),
          share_of_parent_invested_pct: ratio(subInvested, invested),
        },
      }
    })
    .filter((row) => {
      if (row.is_parent_direct) return row.buckets.invested_assets > 0
      return row.buckets.invested_assets > 0 || row.buckets.cash_tools > 10_000
    })
    .sort((a, b) => {
      if (a.is_parent_direct !== b.is_parent_direct) return a.is_parent_direct ? 1 : -1
      return b.buckets.invested_assets - a.buckets.invested_assets
    })
  const equityPct = ratio(equity, invested)
  const fiPct = ratio(fixedIncome, invested)
  const derivNotionalPct = ratio(derivNotional, invested)
  const derivEquityPct = ratio(derivEquity, investedMv > 0 ? investedMv : invested)
  const fundPct = ratio(funds, invested)
  const leveragePct = ratio(totalAsset, nav)
  const illiquidPct = ratio(article15RestrictedMv(holdings), nav)
  const leverageLimitPct = (illiquidPct ?? 0) > 20 ? 120 : 200

  let maxSinglePct: number | null = null
  let maxSingleName: string | null = null
  let maxBondPct: number | null = null
  let maxBondName: string | null = null
  for (const item of conc.values()) {
    if (nav <= 0) continue
    const pct = (item.value / nav) * 100
    if (!item.exempt && (maxSinglePct == null || pct > maxSinglePct)) {
      maxSinglePct = pct
      maxSingleName = item.name
    }
    if (item.bond && !item.exempt && (maxBondPct == null || pct > maxBondPct)) {
      maxBondPct = pct
      maxBondName = item.name
    }
  }
  if (hasValuation && nav > 0 && maxBondPct == null) maxBondPct = 0
  const bondExemptNote = [...bondExemptMv.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, value]) => `${name} ${(value / 10_000).toFixed(2)}万`)
    .join("、") || null

  const checkInput = {
    equityPct,
    fiPct,
    derivNotionalPct,
    derivEquityPct,
    leveragePct,
    leverageLimitPct,
    illiquidPct,
    maxSinglePct,
    maxBondPct,
    maxSingleName,
    maxBondName,
    bondExemptNote,
    lookthroughComplete: flat.missing.length === 0,
    lookthroughAttempted: lookthrough && flat.underlyingCount > 0,
    missing: flat.missing,
    hasValuation,
  }

  const checks_by_category = {
    权益类: buildChecks("权益类", checkInput),
    固定收益类: buildChecks("固定收益类", checkInput),
    混合类: buildChecks("混合类", checkInput),
    期货和衍生品类: buildChecks("期货和衍生品类", checkInput),
  }

  topHoldings.sort((a, b) => b.market_value - a.market_value)

  return {
    id: product.id,
    product_name: product.product_name,
    beian_hao: product.beian_hao,
    valuation_date: meta?.valuation_date ?? null,
    unit_nav: meta?.unit_nav ?? null,
    net_asset_value: nav,
    total_asset: totalAsset,
    is_fof: lookthrough && flat.underlyingCount > 0,
    has_valuation: hasValuation,
    lookthrough: {
      attempted: lookthrough && flat.underlyingCount > 0,
      complete: flat.underlyingCount === 0 || flat.missing.length === 0,
      underlying_count: flat.underlyingCount,
      penetrated_count: flat.penetrated,
      missing: flat.missing,
    },
    buckets: {
      equity,
      fixed_income: fixedIncome,
      derivatives_notional: derivNotional,
      derivatives_equity: derivEquity,
      cash_tools: cashTools,
      funds_unpenetrated: funds,
      other,
      invested_assets: invested,
    },
    ratios: {
      equity_pct: equityPct,
      fixed_income_pct: fiPct,
      derivatives_notional_pct: derivNotionalPct,
      derivatives_equity_pct: derivEquityPct,
      leverage_pct: leveragePct,
      leverage_limit_pct: leverageLimitPct,
      illiquid_restricted_pct: illiquidPct,
      max_single_asset_pct: maxSinglePct,
      max_single_bond_pct: maxBondPct,
    },
    inferred_type: inferType({
      equityPct,
      fiPct,
      derivNotionalPct,
      derivEquityPct,
      fundPct,
    }),
    top_holdings: opts?.maxHoldings == null
      ? topHoldings
      : topHoldings.slice(0, Math.max(0, opts.maxHoldings)),
    subfund_structures,
    checks_by_category,
  }
}

function stripShareClassCode(code: string): string {
  return code.replace(/[ABC]$/i, "")
}

function formatLookthroughStrategy(
  l1: string | null | undefined,
  l2: string | null | undefined,
  l3: string | null | undefined,
): string | null {
  const parts = [l1, l2, l3].map((v) => (v ?? "").trim()).filter(Boolean)
  return parts.length > 0 ? parts.join("/") : null
}

async function loadSubfundStrategyMap(
  codes: string[],
  names: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const resolved = sqlType6TableResolvedStrategy()
  const uniqueCodes = [...new Set(codes.map((c) => c.trim()).filter(Boolean))]
  const codeKeys = [...new Set(uniqueCodes.map((c) => c.toUpperCase()))]
  const strippedKeys = [...new Set(codeKeys.map(stripShareClassCode).filter(Boolean))]

  if (codeKeys.length > 0) {
    const rows = await query<{ register_number: string; l1: string | null; l2: string | null; l3: string | null }>(
      `SELECT DISTINCT ON (register_number)
         register_number,
         ${resolved.l1} AS l1,
         ${resolved.l2} AS l2,
         ${resolved.l3} AS l3
       FROM type6_ops_team_full
       WHERE UPPER(BTRIM(register_number)) = ANY($1::text[])
          OR regexp_replace(UPPER(BTRIM(register_number)), '[ABC]$', '') = ANY($2::text[])
       ORDER BY register_number, updated_at DESC NULLS LAST, id DESC`,
      [codeKeys, strippedKeys],
    ).catch(() => [])
    for (const row of rows) {
      const label = formatLookthroughStrategy(row.l1, row.l2, row.l3)
      if (!label) continue
      const upper = row.register_number.trim().toUpperCase()
      out.set(upper, label)
      out.set(stripShareClassCode(upper), label)
    }
  }

  const uniqueNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (uniqueNames.length > 0) {
    const named = sqlType6TableResolvedStrategy("o")
    const rows = await query<{ product_name: string; l1: string | null; l2: string | null; l3: string | null }>(
      `SELECT DISTINCT ON (n.name)
         n.name AS product_name,
         ${named.l1} AS l1,
         ${named.l2} AS l2,
         ${named.l3} AS l3
       FROM unnest($1::text[]) AS n(name)
       JOIN type6_ops_team_full o ON (
         ${sqlFundNameMatch("o.fund_name", "n.name")}
         OR ${sqlFundNameMatch("o.fund_short_name", "n.name")}
       )
       ORDER BY n.name, o.updated_at DESC NULLS LAST, o.id DESC`,
      [uniqueNames],
    ).catch(() => [])
    for (const row of rows) {
      const label = formatLookthroughStrategy(row.l1, row.l2, row.l3)
      if (!label) continue
      if (!out.has(row.product_name)) out.set(row.product_name, label)
    }
  }

  return out
}

function lookupSubfundStrategy(
  map: Map<string, string>,
  code: string | null,
  name: string,
): string | null {
  if (code) {
    const upper = code.trim().toUpperCase()
    const hit = map.get(upper) || map.get(stripShareClassCode(upper))
    if (hit) return hit
  }
  return map.get(name) ?? null
}

async function attachSubfundStrategies(
  products: LookthroughComplianceProduct[],
): Promise<LookthroughComplianceProduct[]> {
  const codes: string[] = []
  const names: string[] = []
  for (const product of products) {
    for (const row of product.subfund_structures) {
      if (row.is_parent_direct) continue
      if (row.product_code) codes.push(row.product_code)
      if (row.name) names.push(row.name)
    }
  }
  if (codes.length === 0 && names.length === 0) return products

  const map = await loadSubfundStrategyMap(codes, names)
  return products.map((product) => ({
    ...product,
    subfund_structures: product.subfund_structures.map((row) => ({
      ...row,
      fund_strategy: row.is_parent_direct ? null : lookupSubfundStrategy(map, row.product_code, row.name),
    })),
  }))
}

export async function queryLookthroughCompliance(): Promise<LookthroughComplianceResult> {
  await ensureEmailValuationTable()
  await ensureEmailValuationHoldingsTables()

  const products = await loadManagedProducts()
  const savedCategories = await loadLookthroughProductCategories()
  const latestByProduct = await loadLatestValuationsForManaged(products)
  const managedRecordIds = [...latestByProduct.values()].map((m) => m.id)
  const catalog = await loadLatestValuationCatalog()

  const underlyingIds = new Set<number>()
  const managedHoldings = await loadHoldingsByRecordIds(managedRecordIds)

  for (const [productId, meta] of latestByProduct) {
    const product = products.find((p) => p.id === productId)
    if (!product || isExcludedNonFof(product.product_name)) continue
    const holdings = managedHoldings.get(meta.id) ?? []
    for (const h of holdings) {
      if (!isPrivateFundHolding(h)) continue
      const found = findUnderlyingMeta(h, catalog, {
        product_code: meta.product_code,
        fund_name: meta.fund_name,
        record_id: meta.id,
      })
      if (found) underlyingIds.add(found.id)
    }
  }

  const extraIds = [...underlyingIds].filter((id) => !managedHoldings.has(id))
  const extraHoldings = await loadHoldingsByRecordIds(extraIds)
  const holdingsByRecord = new Map(managedHoldings)
  for (const [id, rows] of extraHoldings) holdingsByRecord.set(id, rows)

  const resultProducts = await attachSubfundStrategies(
    products.map((product) => {
      const meta = latestByProduct.get(product.id)
      const holdings = meta ? (holdingsByRecord.get(meta.id) ?? []) : []
      const evaluated = evaluateProduct(product, meta, holdings, catalog, holdingsByRecord, { maxHoldings: 80 })
      return {
        ...evaluated,
        assigned_category: savedCategories.get(product.id) ?? null,
      }
    }),
  )

  return {
    as_of: new Date().toISOString().slice(0, 10),
    products: resultProducts,
  }
}

async function loadLatestValuationByCode(beianHao: string): Promise<ValuationMeta | null> {
  const rows = await query<{
    id: string
    product_code: string | null
    fund_name: string | null
    valuation_date: string
    net_asset_value: string | null
    net_asset: string | null
    total_asset: string | null
    total_liability: string | null
    unit_nav: string | null
  }>(
    `SELECT
       id::text,
       product_code,
       fund_name,
       valuation_date::text,
       net_asset_value::text,
       net_asset::text,
       total_asset::text,
       total_liability::text,
       unit_nav::text
     FROM ops_email_valuation_records
     WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
       AND (
         UPPER(BTRIM(product_code)) = UPPER(BTRIM($1))
         OR regexp_replace(UPPER(BTRIM(product_code)), '[ABC]$', '')
            = regexp_replace(UPPER(BTRIM($1)), '[ABC]$', '')
       )
     ORDER BY valuation_date DESC, id DESC
     LIMIT 1`,
    [beianHao],
  )
  const row = rows[0]
  if (!row) return null
  const nav = toNum(row.net_asset_value) || toNum(row.net_asset)
  const totalAsset = toNum(row.total_asset)
    || (nav > 0 && toNum(row.total_liability) >= 0 ? nav + toNum(row.total_liability) : nav)
  return {
    id: Number(row.id),
    product_code: row.product_code,
    fund_name: row.fund_name,
    valuation_date: row.valuation_date,
    net_asset_value: nav,
    total_asset: totalAsset,
    unit_nav: toNum(row.unit_nav) || null,
  }
}

function pickCatalogMeta(
  catalog: ValuationMeta[],
  beianHao: string,
  productName: string | null,
): ValuationMeta | null {
  const scored: Array<{ meta: ValuationMeta; score: number }> = []
  for (const meta of catalog) {
    let score = 0
    if (codesMatch(meta.product_code, beianHao)) score += 4
    if (productName && namesMatch(meta.fund_name, productName)) score += 3
    if (score > 0) scored.push({ meta, score })
  }
  scored.sort((a, b) => b.score - a.score || b.meta.valuation_date.localeCompare(a.meta.valuation_date))
  return scored[0]?.meta ?? null
}

async function evaluateWithLookthrough(
  product: ManagedProductRow,
  meta: ValuationMeta | undefined,
  catalog: ValuationMeta[],
  opts?: { maxHoldings?: number | null },
): Promise<LookthroughComplianceProduct> {
  if (!meta) return evaluateProduct(product, undefined, [], catalog, new Map(), opts)

  const holdingsByRecord = await loadHoldingsByRecordIds([meta.id])
  const holdings = holdingsByRecord.get(meta.id) ?? []
  if (!isExcludedNonFof(product.product_name)) {
    const extraIds: number[] = []
    for (const h of holdings) {
      if (!isPrivateFundHolding(h)) continue
      const found = findUnderlyingMeta(h, catalog, {
        product_code: meta.product_code,
        fund_name: meta.fund_name,
        record_id: meta.id,
      })
      if (found && !holdingsByRecord.has(found.id)) extraIds.push(found.id)
    }
    const extra = await loadHoldingsByRecordIds([...new Set(extraIds)])
    for (const [id, rows] of extra) holdingsByRecord.set(id, rows)
  }
  return evaluateProduct(product, meta, holdings, catalog, holdingsByRecord, opts)
}

export async function queryLookthroughComplianceForFund(
  rawBeianHao: string,
): Promise<LookthroughComplianceProduct> {
  await ensureEmailValuationTable()
  await ensureEmailValuationHoldingsTables()

  const beianHao = rawBeianHao.trim()
  const nameRows = await query<{ product_name: string | null }>(
    `SELECT product_name
     FROM private_fund_info
     WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))
     LIMIT 1`,
    [beianHao],
  )
  const productName = nameRows[0]?.product_name?.trim() || null

  const catalog = await loadLatestValuationCatalog()
  const meta = pickCatalogMeta(catalog, beianHao, productName)
    ?? await loadLatestValuationByCode(beianHao)

  const product: ManagedProductRow = {
    id: meta?.id ?? 0,
    product_name: meta?.fund_name || productName || beianHao,
    beian_hao: beianHao,
  }
  const evaluated = await evaluateWithLookthrough(product, meta ?? undefined, catalog, { maxHoldings: null })
  const [withStrategy] = await attachSubfundStrategies([
    {
      ...evaluated,
      assigned_category: await loadLookthroughCategoryByBeian(beianHao),
    },
  ])
  return withStrategy
}

export const lookthroughComplianceQueries = {
  forFund: queryLookthroughComplianceForFund,
  allManaged: queryLookthroughCompliance,
}
