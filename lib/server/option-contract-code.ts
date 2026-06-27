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

export function remapValuationOptionProduct(code: string): string {
  const m = code.match(/^([A-Z]+)(\d{3,4}[CP]\d+)$/i)
  if (!m) return code.toUpperCase()
  const product = VALUATION_PRODUCT_ALIASES[m[1].toUpperCase()] ?? m[1].toUpperCase()
  return `${product}${m[2].toUpperCase()}`
}

export function extractOptionContractFromText(symbol: string | null, subjectName: string): string | null {
  const text = `${symbol ?? ""}${subjectName}`
  const match = text.match(/([A-Za-z]{1,6}\d{3,4}[CPcp]\d+)/)
  if (!match) return null
  return remapValuationOptionProduct(match[1])
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
