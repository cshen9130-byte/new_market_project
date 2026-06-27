const DERIVATIVE_SECTOR_RULES: Record<string, Set<string>> = {
  农产: new Set([
    "C", "CS", "WH", "PM", "RR", "RI", "JR", "LR", "A", "B", "M", "Y", "RM", "OI", "RS", "PK", "P",
    "SR", "CF", "CY", "AP", "CJ", "LH", "JD", "LG", "SP", "OP",
  ]),
  有色: new Set(["CU", "BC", "AL", "AO", "AD", "ZN", "PB", "NI", "SN"]),
  黑色: new Set(["I", "SF", "SM", "RB", "HC", "SS", "WR", "JM", "J", "ZC", "FG", "BB", "FB"]),
  能化: new Set([
    "SC", "FU", "LU", "PG", "BU", "TA", "EG", "PF", "PR", "PL", "PP", "L", "BZ", "PX", "EB", "RU",
    "BR", "NR", "SA", "SH", "V", "UR", "MA", "LC", "PS", "SI", "EC", "AU", "AG",
  ]),
  股指: new Set(["IH", "IF", "IC", "IM", "MO"]),
  国债: new Set(["TS", "TF", "T", "TL"]),
}

export type DerivativeSector = "黑色" | "有色" | "能化" | "农产" | "股指" | "国债" | "其他"

export function extractContractRootSymbol(symbol: string | null, subjectName: string): string {
  if (symbol) {
    const match = symbol.match(/^([A-Za-z]+)/)
    if (match) return match[1].toUpperCase()
  }
  const fromName = subjectName.match(/([A-Za-z]{1,4}\d{3,4})/)
  if (fromName) {
    const match = fromName[1].match(/^([A-Za-z]+)/)
    if (match) return match[1].toUpperCase()
  }
  return ""
}

export function inferDerivativeSector(
  symbol: string | null,
  subjectName: string,
  assetClass: string | null,
): DerivativeSector {
  if (assetClass === "股指期货") return "股指"
  if (assetClass === "国债期货") return "国债"
  const root = extractContractRootSymbol(symbol, subjectName)
  for (const [sector, codes] of Object.entries(DERIVATIVE_SECTOR_RULES)) {
    if (codes.has(root)) return sector as DerivativeSector
  }
  return "其他"
}

export const DERIVATIVE_SECTOR_TABS = ["全部", "黑色", "有色", "能化", "农产", "股指", "国债"] as const
export type DerivativeSectorTab = (typeof DERIVATIVE_SECTOR_TABS)[number]

/** X-axis order for 期货板块市值占比 chart/table. */
export const DERIVATIVE_SECTOR_CHART_ORDER = ["有色", "黑色", "能化", "农产", "股指", "国债"] as const
export type DerivativeChartSector = (typeof DERIVATIVE_SECTOR_CHART_ORDER)[number]
