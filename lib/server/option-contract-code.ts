/**
 * Map broker / 估值表 option codes to Choice API contract format (e.g. TA809P5400.CZC).
 */

/** Valuation-table product prefixes that differ from exchange tickers. */
const VALUATION_PRODUCT_ALIASES: Record<string, string> = {
  PTA: "TA",
}

const PRODUCT_EXCHANGE: Record<string, string> = {
  A: "DCE", B: "DCE", BB: "DCE", BZ: "DCE", C: "DCE", CS: "DCE", EB: "DCE", EG: "DCE",
  FB: "DCE", I: "DCE", J: "DCE", JD: "DCE", JM: "DCE", L: "DCE", LG: "DCE", LH: "DCE",
  M: "DCE", P: "DCE", PG: "DCE", PP: "DCE", RR: "DCE", V: "DCE", Y: "DCE",
  AD: "SHF", AG: "SHF", AL: "SHF", AO: "SHF", AU: "SHF", BC: "SHF", BR: "SHF", BU: "SHF",
  CU: "SHF", FU: "SHF", HC: "SHF", NI: "SHF", NR: "SHF", PB: "SHF", PD: "SHF", PL: "SHF",
  PT: "SHF", RB: "SHF", RU: "SHF", SN: "SHF", SP: "SHF", SS: "SHF", WR: "SHF", ZN: "SHF",
  EC: "INE", LU: "INE", SC: "INE",
  AP: "CZC", CF: "CZC", CJ: "CZC", CY: "CZC", ER: "CZC", FG: "CZC", JR: "CZC", LR: "CZC",
  MA: "CZC", OI: "CZC", PF: "CZC", PK: "CZC", PM: "CZC", PR: "CZC", PX: "CZC", RI: "CZC",
  RM: "CZC", RO: "CZC", RS: "CZC", SA: "CZC", SF: "CZC", SH: "CZC", SM: "CZC", SR: "CZC",
  TA: "CZC", TC: "CZC", UR: "CZC", WH: "CZC", WS: "CZC", ZC: "CZC",
  LC: "GFE", PS: "GFE", SI: "GFE",
  IC: "CFE", IF: "CFE", IH: "CFE", IM: "CFE", IO: "CFE", HO: "CFE", MO: "CFE",
  T: "CFE", TF: "CFE", TL: "CFE", TS: "CFE",
}

/** 估值表 3102 下的交易所账户段，不是合约：D801 / DC01 / DD01。 */
export function isValuationAccountPrefixSymbol(symbol: string): boolean {
  const u = String(symbol ?? "").toUpperCase()
  if (!u) return false
  if (/^(DD|DE|DF|DG)\d/.test(u)) return true
  if (/^[A-Z]\d{3}$/.test(u)) return true
  if (/^[A-Z]{2}\d{2}$/.test(u)) return true
  return false
}

const OPTION_CODE_RE = /([A-Za-z]{1,6}\d{3,4}[-_]?[CPcp][-_]?\d+)/
const CN_OPTION_NAME_RE = /([\u4e00-\u9fff]+(?:认)?[沽购]\d{1,2}月\d+)/u
const OPTION_PARENT_NAME_RE = /衍生工具_.*期权|(?:期权)?认[沽购](?:义务方|权利方)|义务方_成本|权利方_成本/u
const CASH_OPTION_NAME_RE = /银行存款|结算备付金|存出保证金/u

export function remapValuationOptionProduct(code: string): string {
  const m = code.match(/^([A-Z]+)(\d{3,4}[CP]\d+)$/i)
  if (!m) return code.toUpperCase()
  const product = VALUATION_PRODUCT_ALIASES[m[1].toUpperCase()] ?? m[1].toUpperCase()
  return `${product}${m[2].toUpperCase()}`
}

export function extractOptionContractFromText(
  symbol: string | null,
  subjectName: string,
  ...extra: Array<string | null | undefined>
): string | null {
  const text = [symbol, subjectName, ...extra].filter(Boolean).join("")
  const dashed = text.match(OPTION_CODE_RE)
  if (dashed) {
    const compact = dashed[1].replace(/[-_]/g, "")
    if (!isValuationAccountPrefixSymbol(compact.replace(/[CPcp]\d+$/, ""))) {
      return remapValuationOptionProduct(compact)
    }
  }
  const glued = text.replace(/[-_\s.]/g, "")
  const match = glued.match(/([A-Za-z]{1,6}\d{3,4}[CPcp]\d+)/)
  if (!match) return null
  return remapValuationOptionProduct(match[1])
}

export function isChineseOptionContractName(name: string): boolean {
  return CN_OPTION_NAME_RE.test(String(name ?? ""))
}

export function isOptionAccountSummaryName(name: string): boolean {
  const raw = String(name ?? "").trim()
  if (!raw || isChineseOptionContractName(raw)) return false
  return OPTION_PARENT_NAME_RE.test(raw)
}

export function looksLikeOptionContract(
  code: string,
  name: string,
  symbol?: string | null,
): boolean {
  const subject = String(name ?? "").trim()
  if (CASH_OPTION_NAME_RE.test(subject) && !isChineseOptionContractName(subject)) return false
  if (isChineseOptionContractName(subject)) return true
  return Boolean(extractOptionContractFromText(symbol ?? null, subject, code))
}

/** 期权持仓「资产名称」：合约中文名，而不是 衍生工具_…义务方_成本. */
export function optionHoldingDisplayName(
  subjectName: string,
  symbol?: string | null,
  ...codes: Array<string | null | undefined>
): string {
  const name = String(subjectName ?? "").trim()
  const cn = name.match(CN_OPTION_NAME_RE)
  if (cn) return cn[1]

  const contract = extractOptionContractFromText(symbol ?? null, name, ...codes)
  if (isOptionAccountSummaryName(name) || CASH_OPTION_NAME_RE.test(name)) {
    return contract || name
  }

  const leaf = name.split(/[_/]+/u).map((part) => part.trim()).filter(Boolean).pop() ?? ""
  const leafCn = leaf.match(CN_OPTION_NAME_RE)
  if (leafCn) return leafCn[1]
  if (contract) return contract
  if (leaf && !/^(成本|市价|份额)$/u.test(leaf) && leaf !== name) return leaf
  return name || String(symbol ?? "").trim()
}

/** Convert CTP / 估值表 code to Choice API format, e.g. TA809P5400 → TA809P5400.CZC */
export function normalizeOptionContractCode(raw: string): string | null {
  const code = raw.trim()
  if (!code) return null

  if (code.includes(".")) {
    const [productPart, exchPart] = code.toUpperCase().split(".", 2)
    if (productPart && exchPart) return `${productPart}.${exchPart}`
  }

  const clean = code.replace(/[^A-Za-z0-9]/g, "")
  const remapped = remapValuationOptionProduct(clean)
  const m = remapped.match(/^([A-Z]+)(\d{3,4}[CP]\d+)$/)
  if (!m) return null

  const product = m[1]
  const rest = m[2]
  const exchange = PRODUCT_EXCHANGE[product]
  if (!exchange) return null

  return `${product}${rest}.${exchange}`
}
