/**
 * 国泰君安托管《私募运作指引》各产品类型投资比例监控数据（202607）
 *
 * 第41条产品类别：已投资产 = 估值表资产合计 − 现金管理工具。
 * 券商普通资金账户（103106）可不计入已投资产。
 * 现金管理工具不含国债逆回购、非普通户/非托管户现金。
 */

export const GS_CUSTODY_RULES_LABEL = "国泰君安托管202607"

/** 托管户活期及应计利息：1002 / 100201 / 100206 */
const CUSTODY_DEPOSIT_PREFIXES = ["1002"] as const

/** 券商普通资金账户。简版分母明确扣除；备注：可不计入已投资产。 */
const ORDINARY_BROKER_CASH_PREFIXES = ["103106"] as const

/** 信用账户资金：非普通户，计入已投资产，不是现金管理工具。 */
const CREDIT_ACCOUNT_CASH_PREFIXES = ["103151"] as const

const TREASURY_PREFIXES = ["110311", "110318", "110321", "110331", "110351", "110371", "110378"] as const
const CBILL_PREFIXES = ["110355", "110375", "110395"] as const
const POLICY_BOND_PREFIXES = ["110320", "110369", "110390"] as const
const MUNI_BOND_PREFIXES = ["110314", "110352", "110392"] as const

const CASH_BOND_PREFIXES = [
  ...TREASURY_PREFIXES,
  ...CBILL_PREFIXES,
  ...POLICY_BOND_PREFIXES,
  ...MUNI_BOND_PREFIXES,
] as const

/** 场内期货/套保初始合约价值。GS 科目供参考；华泰四级用 310223/310224 记郑商所买卖方。 */
const FUTURES_NOTIONAL_PREFIXES = [
  "31020101",
  "31020201",
  "31020301",
  "31020401",
  "32010121",
  "32010201",
  "31020501",
  "31020601",
  "31020701",
  "31020801",
  "31020901",
  "31021001",
  "31022301",
  "31022401",
  "31023101",
  "31023201",
  "31023501",
  "31023601",
] as const

/**
 * 期货及期权账户权益：
 * GS：102113/103113/102131/103131/103133。
 * 华泰四级：102102 期货期权备付金、103103 期货保证金。
 */
const DERIV_ACCOUNT_EQUITY_PREFIXES = [
  "102113",
  "103113",
  "102131",
  "103131",
  "103133",
  "102102",
  "103103",
] as const

export type GsHoldingLike = {
  subject_code?: string | null
  subject_name?: string | null
  asset_class?: string | null
  row_kind?: string | null
  symbol?: string | null
}

export function compactGsSubjectCode(code: string | null | undefined): string {
  return String(code ?? "").replace(/[\s.]/g, "")
}

function codeStartsWithAny(code: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => code.startsWith(prefix))
}

function holdingBlob(h: GsHoldingLike): string {
  return `${h.subject_name ?? ""} ${h.asset_class ?? ""}`
}

function compactName(h: GsHoldingLike): string {
  return String(h.subject_name ?? "").replace(/[\s\u3000]+/g, "")
}

export function isGsOffsetOrIncrementName(name: string): boolean {
  return /冲销|冲抵|估值增值/.test(String(name ?? "").replace(/[\s\u3000]+/g, ""))
}

export function isGsOtcDerivativeSubject(h: GsHoldingLike): boolean {
  return compactGsSubjectCode(h.subject_code).startsWith("1114")
}

export function isGsSecuritiesLendingLiability(h: GsHoldingLike): boolean {
  return compactGsSubjectCode(h.subject_code).startsWith("2101")
}

export function isGsOrdinaryBrokerCash(h: GsHoldingLike): boolean {
  return codeStartsWithAny(compactGsSubjectCode(h.subject_code), ORDINARY_BROKER_CASH_PREFIXES)
}

export function isGsCreditAccountCash(h: GsHoldingLike): boolean {
  return codeStartsWithAny(compactGsSubjectCode(h.subject_code), CREDIT_ACCOUNT_CASH_PREFIXES)
}

export function isGsCashBondSubject(h: GsHoldingLike): boolean {
  const kind = h.row_kind ?? ""
  if (kind === "derivative" || kind === "option") return false
  const code = compactGsSubjectCode(h.subject_code)
  if (code.startsWith("3102") || code.startsWith("3201")) return false
  if (codeStartsWithAny(code, CASH_BOND_PREFIXES)) return true
  const blob = holdingBlob(h)
  if (/期货|期权|合约/.test(blob)) return false
  if (!/债|票据|央票/.test(blob)) return false
  if (/可转债|可交换债|信用债|企业债|公司债|中票|短融|超短融|同业存单/.test(blob)) return false
  return /国债|中央银行票据|央票|政策性金融|国开债|农发债|口行债|进出口行|地方政府债|地方债/.test(blob)
}

export function isGsMoneyFund(h: GsHoldingLike): boolean {
  const kind = h.row_kind ?? ""
  if (kind === "money_fund") return true
  const blob = holdingBlob(h)
  return /货币市场基金|货币型基金|货币基金/.test(blob) || (/货币/.test(blob) && compactGsSubjectCode(h.subject_code).startsWith("1105"))
}

export function isGsBondFund(h: GsHoldingLike): boolean {
  if (isGsMoneyFund(h)) return false
  const blob = holdingBlob(h)
  return /债券|固收|短债/.test(blob) && !/可转债|可交换债|转债基金/.test(blob)
}

export function isGsEquityFund(h: GsHoldingLike): boolean {
  const code = compactGsSubjectCode(h.subject_code)
  const kind = h.row_kind ?? ""
  const isFundSubject = kind === "fund" || kind === "fund_or_stock" || code.startsWith("1105")
  if (!isFundSubject) return false
  if (isGsMoneyFund(h) || isGsBondFund(h)) return false
  if (/私募/.test(holdingBlob(h))) return false
  return true
}

export function isGsCustodyDeposit(h: GsHoldingLike): boolean {
  const kind = h.row_kind ?? ""
  const code = compactGsSubjectCode(h.subject_code)
  if (kind === "bank_deposit") return true
  return codeStartsWithAny(code, CUSTODY_DEPOSIT_PREFIXES)
}

/** 现金管理工具：托管户活期、普通证券资金账户、国债/央票/政金债/地方债、货基。 */
export function isGsCashToolHolding(h: GsHoldingLike): boolean {
  if (isGsSecuritiesLendingLiability(h) || isGsOtcDerivativeSubject(h)) return false
  const kind = h.row_kind ?? ""
  if (kind === "derivative" || kind === "option") return false
  if (isGsCustodyDeposit(h)) return true
  if (isGsOrdinaryBrokerCash(h)) return true
  if (isGsMoneyFund(h)) return true
  if (isGsCashBondSubject(h)) return true
  return false
}

export function isGsStockSubject(h: GsHoldingLike): boolean {
  const code = compactGsSubjectCode(h.subject_code)
  const kind = h.row_kind ?? ""
  if (code.startsWith("1102")) return true
  if (kind === "stock") return true
  return false
}

/**
 * 权益分子：股票市值(1102) + 股票类基金(1105) − 融券(2101)。
 * 可转债、信用账户包装、券商保证金不计入。
 */
export function isGsEquityHolding(h: GsHoldingLike): boolean {
  if (isGsSecuritiesLendingLiability(h) || isGsCashToolHolding(h)) return false
  if (isGsOtcDerivativeSubject(h)) return false
  const blob = holdingBlob(h)
  if (/可转债|可交换债/.test(blob)) return false
  if (isGsEquityFund(h)) return true
  return isGsStockSubject(h)
}

export function isGsRepoHolding(h: GsHoldingLike): boolean {
  const kind = h.row_kind ?? ""
  const code = compactGsSubjectCode(h.subject_code)
  const name = h.subject_name ?? ""
  if (code.startsWith("2202") || /卖出回购/.test(name)) return false
  if (kind === "repo" || code.startsWith("1202")) return true
  if (/协议回购/.test(name)) return false
  return /质押式回购|买断式回购|债券回购|逆回购/.test(name)
}

/** 债权类：信用债、逆回购、债券基金、可转债。现金管理工具债券除外。 */
export function isGsFixedIncomeHolding(h: GsHoldingLike): boolean {
  if (isGsCashToolHolding(h) || isGsSecuritiesLendingLiability(h)) return false
  if (isGsOtcDerivativeSubject(h)) return false
  if (isGsBondFund(h)) return true
  if (isGsRepoHolding(h)) return true
  const blob = holdingBlob(h)
  if (/可转债|可交换债/.test(blob)) return true
  const kind = h.row_kind ?? ""
  const code = compactGsSubjectCode(h.subject_code)
  if (kind === "bond" || code.startsWith("1101") || code.startsWith("1103")) return true
  return false
}

export function isGsListedFuturesNotionalCode(code: string): boolean {
  return codeStartsWithAny(code, FUTURES_NOTIONAL_PREFIXES)
}

export function isGsOptionNotionalHolding(h: GsHoldingLike): boolean {
  if (isGsOtcDerivativeSubject(h) || isGsOffsetOrIncrementName(h.subject_name ?? "")) return false
  const kind = h.row_kind ?? ""
  const blob = holdingBlob(h)
  if (/履约金|保证金|备付金/.test(blob)) return false
  if (kind === "option") return true
  return /期权/.test(blob) && !/账户/.test(blob)
}

function hasListedFuturesContractId(h: GsHoldingLike): boolean {
  const blob = `${h.subject_code ?? ""} ${h.subject_name ?? ""} ${h.symbol ?? ""}`
  if (isGsOffsetOrIncrementName(h.subject_name ?? "")) return false
  if (/[A-Za-z]{1,4}\d{2,5}/.test(blob)) return true
  return false
}

/**
 * 场内持仓合约价值。场外 1114 不自动计入（托管：行业规则未明确，需手工调整）。
 * 华泰四级常写成「商品期货_成本.PTA2702」，没有「初始合约价值」字样。
 */
export function isGsFuturesNotionalHolding(h: GsHoldingLike): boolean {
  if (isGsOffsetOrIncrementName(h.subject_name ?? "")) return false
  if (isGsOtcDerivativeSubject(h)) return false
  const code = compactGsSubjectCode(h.subject_code)
  const compact = compactName(h)
  if (isGsListedFuturesNotionalCode(code)) return true
  if (isGsOptionNotionalHolding(h)) return true
  if ((code.startsWith("3102") || code.startsWith("3201")) && hasListedFuturesContractId(h)) {
    return true
  }
  if ((code.startsWith("3102") || code.startsWith("3201")) && /初始合约|合约价值|商品期货|股指期货|国债期货/.test(compact)) {
    return true
  }
  const kind = h.row_kind ?? ""
  if ((kind === "derivative" || kind === "option") && /初始合约|合约价值|商品期货|股指期货/.test(compact)) {
    return true
  }
  if (/初始合约/.test(compact) && !/冲销|冲抵|估值增值/.test(compact)) return true
  return false
}

export function isGsDerivAccountEquityHolding(h: GsHoldingLike): boolean {
  if (isGsOtcDerivativeSubject(h)) return false
  const code = compactGsSubjectCode(h.subject_code)
  if (codeStartsWithAny(code, ["103106", "103151", "103173"])) return false
  if (codeStartsWithAny(code, DERIV_ACCOUNT_EQUITY_PREFIXES)) return true
  const blob = holdingBlob(h)
  if (/期货期权备付金|期货清算备付金|期货备付金|期货保证金|期货存出保证金/.test(blob)) return true
  // 招商四级：1021.QH17 结算备付金_清算备付金_国泰君安期货 / 1031.QHC17 存出保证金_国泰君安期货
  if (
    (code.startsWith("1021") || code.startsWith("1031"))
    && /期货/.test(blob)
    && /备付金|保证金/.test(blob)
  ) {
    return true
  }
  return false
}

export function gsArticle41InvestedAssets(totalAsset: number, cashTools: number): number {
  if (!(totalAsset > 0)) return 0
  return Math.max(0, totalAsset - Math.max(0, cashTools))
}
