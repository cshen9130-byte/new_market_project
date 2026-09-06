/**
 * Product-scoped settlement analysis. Tries 国信盯市 first, then CFMMC
 * 客户交易结算日报. Never writes public.cfmmc_* / public.mom_*.
 */

import { parseCfmmcWorkbook } from "@/lib/server/cfmmc-etl"
import {
  analyzeSettlementWorkbook,
  extractSettlementProductCode,
  getSettlementProductName,
  getSettlementSector,
  inferSettlementStrategy,
  type SettlementWorkbookAnalysis,
} from "@/lib/server/settlement-account-etl"

const EXCHANGE_BY_CODE: Record<string, string> = {
  IF: "中金所", IH: "中金所", IC: "中金所", IM: "中金所",
  T: "中金所", TF: "中金所", TS: "中金所", TL: "中金所",
  AU: "上期所", AG: "上期所", CU: "上期所", AL: "上期所", ZN: "上期所",
  PB: "上期所", NI: "上期所", SN: "上期所", AO: "上期所", RB: "上期所",
  HC: "上期所", SS: "上期所", FU: "上期所", BU: "上期所", RU: "上期所",
  BR: "上期所", SP: "上期所", AD: "上期所",
  SC: "上期能源", LU: "上期能源", NR: "上期能源", BC: "上期能源", EC: "上期能源",
  I: "大商所", J: "大商所", JM: "大商所", M: "大商所", Y: "大商所",
  P: "大商所", C: "大商所", CS: "大商所", A: "大商所", B: "大商所",
  L: "大商所", V: "大商所", PP: "大商所", EG: "大商所", EB: "大商所",
  PG: "大商所", LH: "大商所", LG: "大商所",
  TA: "郑商所", MA: "郑商所", SR: "郑商所", CF: "郑商所", CY: "郑商所",
  AP: "郑商所", CJ: "郑商所", RM: "郑商所", OI: "郑商所", FG: "郑商所",
  SA: "郑商所", UR: "郑商所", SF: "郑商所", SM: "郑商所", ZC: "郑商所",
  PF: "郑商所", PK: "郑商所", SH: "郑商所", PX: "郑商所", PR: "郑商所",
  SI: "广期所", LC: "广期所", PS: "广期所",
}

function inferExchange(productCode: string): string {
  return EXCHANGE_BY_CODE[productCode] || "期货"
}

function analyzeCfmmcWorkbook(buffer: Buffer, sourceFileName: string): SettlementWorkbookAnalysis | null {
  const parsed = parseCfmmcWorkbook(buffer, sourceFileName)
  if (!parsed) return null

  const grouped = new Map<string, {
    instrument: string
    productCode: string
    productName: string
    sector: string
    exchange: string
    longLots: number
    shortLots: number
    longMarketValue: number
    shortMarketValue: number
    mtmPl: number
    marginOccupied: number
    detailRows: number
  }>()

  for (const row of parsed.positions) {
    const instrument = String(row.instrument ?? "").trim()
    if (!instrument) continue
    const productCode = extractSettlementProductCode(instrument)
    const productName = getSettlementProductName(productCode, instrument, instrument)
    const sector = getSettlementSector(productCode, instrument, productName)
    const key = instrument.toUpperCase()
    const bucket = grouped.get(key) ?? {
      instrument,
      productCode,
      productName,
      sector,
      exchange: inferExchange(productCode),
      longLots: 0,
      shortLots: 0,
      longMarketValue: 0,
      shortMarketValue: 0,
      mtmPl: 0,
      marginOccupied: 0,
      detailRows: 0,
    }
    const buyLots = row.buyLots ?? (row.bs === "买" ? (row.lots ?? 0) : 0)
    const sellLots = row.sellLots ?? (row.bs === "卖" ? (row.lots ?? 0) : 0)
    bucket.longLots += buyLots ?? 0
    bucket.shortLots += sellLots ?? 0
    const mv = Math.abs(row.notionalMv ?? 0)
    if ((buyLots ?? 0) > 0) bucket.longMarketValue += mv
    if ((sellLots ?? 0) > 0) bucket.shortMarketValue += mv
    bucket.mtmPl += row.floatingPl ?? 0
    bucket.marginOccupied += row.allocatedMargin ?? 0
    bucket.detailRows += 1
    grouped.set(key, bucket)
  }

  const positions = [...grouped.values()]
    .map((row) => {
      const grossMarketValue = row.longMarketValue + row.shortMarketValue
      return {
        symbol: row.instrument,
        productCode: row.productCode,
        productName: row.productName,
        instrument: row.instrument,
        exchange: row.exchange,
        sector: row.sector,
        longLots: row.longLots,
        shortLots: row.shortLots,
        longMarketValue: row.longMarketValue,
        shortMarketValue: row.shortMarketValue,
        grossMarketValue,
        netMarketValue: row.longMarketValue - row.shortMarketValue,
        mtmPl: row.mtmPl,
        marginOccupied: row.marginOccupied,
      }
    })
    .filter((row) => row.grossMarketValue > 0 || row.longLots > 0 || row.shortLots > 0 || row.mtmPl !== 0)
    .sort((a, b) => b.grossMarketValue - a.grossMarketValue || Math.abs(b.mtmPl) - Math.abs(a.mtmPl))

  const longMarketValue = positions.reduce((sum, row) => sum + row.longMarketValue, 0)
  const shortMarketValue = positions.reduce((sum, row) => sum + row.shortMarketValue, 0)
  const grossExposure = longMarketValue + shortMarketValue
  const netExposure = longMarketValue - shortMarketValue
  const clientEquity = parsed.summary.clientEquity
  const grossLeverage = clientEquity && clientEquity > 0 ? grossExposure / clientEquity : null
  const netExposureRatio = clientEquity && clientEquity > 0 ? netExposure / clientEquity : null
  const riskDegreeRatio = parsed.summary.riskRatio

  const sectorMap = new Map<string, {
    sector: string
    longValue: number
    shortValue: number
    grossValue: number
    netValue: number
    mtmPl: number
  }>()
  const exchangeMap = new Map<string, number>()
  for (const position of positions) {
    const sectorBucket = sectorMap.get(position.sector) ?? {
      sector: position.sector,
      longValue: 0,
      shortValue: 0,
      grossValue: 0,
      netValue: 0,
      mtmPl: 0,
    }
    sectorBucket.longValue += position.longMarketValue
    sectorBucket.shortValue += position.shortMarketValue
    sectorBucket.grossValue += position.grossMarketValue
    sectorBucket.netValue += position.netMarketValue
    sectorBucket.mtmPl += position.mtmPl
    sectorMap.set(position.sector, sectorBucket)
    exchangeMap.set(position.exchange, (exchangeMap.get(position.exchange) ?? 0) + position.grossMarketValue)
  }

  const sectorItems = [...sectorMap.values()].sort((a, b) => b.grossValue - a.grossValue)
  const exchangeItems = [...exchangeMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
  const holdings = positions.slice(0, 12).map((position) => ({
    label: position.symbol || position.productName,
    value: position.grossMarketValue,
    netValue: position.netMarketValue,
    mtmPl: position.mtmPl,
  }))
  const directions = [
    { label: "多头敞口", value: longMarketValue },
    { label: "空头敞口", value: shortMarketValue },
  ].filter((item) => item.value > 0)

  const topPositionShare = grossExposure > 0 && positions[0]
    ? positions[0].grossMarketValue / grossExposure
    : 0
  const topSectorShare = grossExposure > 0 && sectorItems[0]
    ? sectorItems[0].grossValue / grossExposure
    : 0
  const hedgedSectorCount = sectorItems.filter((item) => {
    if (item.longValue <= 0 || item.shortValue <= 0) return false
    const larger = Math.max(item.longValue, item.shortValue)
    const smaller = Math.min(item.longValue, item.shortValue)
    return larger > 0 && smaller / larger >= 0.2
  }).length
  const commodityShare = grossExposure > 0
    ? sectorItems
        .filter((item) => ["农产", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运"].includes(item.sector))
        .reduce((sum, item) => sum + item.grossValue, 0) / grossExposure
    : 0
  const equityIndexShare = grossExposure > 0
    ? sectorItems.filter((item) => item.sector === "股指").reduce((sum, item) => sum + item.grossValue, 0) / grossExposure
    : 0
  const treasuryShare = grossExposure > 0
    ? sectorItems.filter((item) => item.sector === "国债").reduce((sum, item) => sum + item.grossValue, 0) / grossExposure
    : 0
  const optionShare = grossExposure > 0
    ? sectorItems.filter((item) => item.sector === "期权").reduce((sum, item) => sum + item.grossValue, 0) / grossExposure
    : 0

  const warnings: string[] = []
  if (positions.length === 0) warnings.push("已识别为监控中心结算日报，但未提取到有效持仓。")
  if (riskDegreeRatio == null) warnings.push("风险度字段未识别，风控提示主要依据敞口和权益比。")

  return {
    sourceFileName,
    summary: {
      clientId: parsed.summary.accountNo,
      clientName: parsed.summary.clientName,
      tradeDate: parsed.summary.tradeDate,
      dateRangeRaw: parsed.summary.tradeDate,
      clientEquity,
      balanceCf: parsed.summary.balanceCf,
      marginOccupied: parsed.summary.marginOccupied,
      fundAvailable: parsed.summary.available,
      riskDegreeRatio,
      realizedPl: parsed.summary.realizedPl,
      mtmPl: parsed.summary.mtmPl,
      longMarketValue,
      shortMarketValue,
      grossExposure,
      netExposure,
      grossLeverage,
      netExposureRatio,
      positionCount: positions.length,
      detailRowCount: parsed.positions.length,
      sectorCount: sectorItems.length,
      topPositionName: positions[0]?.symbol ?? null,
      topPositionShare: positions[0] && grossExposure > 0 ? topPositionShare : null,
      topSectorName: sectorItems[0]?.sector ?? null,
      topSectorShare: sectorItems[0] && grossExposure > 0 ? topSectorShare : null,
    },
    charts: {
      holdings,
      sectors: sectorItems,
      directions,
      exchanges: exchangeItems,
    },
    positions,
    strategyInference: inferSettlementStrategy({
      grossExposure,
      netExposure,
      longExposure: longMarketValue,
      shortExposure: shortMarketValue,
      grossLeverage,
      riskDegreeRatio,
      fundAvailable: parsed.summary.available,
      clientEquity,
      topPositionShare,
      topSectorShare,
      topSectorName: sectorItems[0]?.sector ?? null,
      hedgedSectorCount,
      commodityShare,
      equityIndexShare,
      treasuryShare,
      optionShare,
    }),
    warnings,
  }
}

export function analyzeProductSettlementWorkbook(
  buffer: Buffer,
  sourceFileName: string,
): SettlementWorkbookAnalysis {
  try {
    return analyzeSettlementWorkbook(buffer, sourceFileName)
  } catch (guosenError) {
    const cfmmc = analyzeCfmmcWorkbook(buffer, sourceFileName)
    if (cfmmc) return cfmmc
    const message = guosenError instanceof Error ? guosenError.message : "结算单分析失败。"
    throw new Error(
      `${message} 也未能识别为中国期货市场监控中心「客户交易结算日报」。请上传国信盯市结算单或监控中心/期货公司结算日报。`,
    )
  }
}
