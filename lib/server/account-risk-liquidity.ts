/**
 * Position liquidity scan for 单账户 (cfmmc_positions + raw_futures_contracts_daily).
 */
import { publicQuery } from "@/lib/db"
import { andScope, scopeWhere } from "@/lib/server/account-risk-scope"
import { toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import { isFuturesInstrument } from "@/lib/server/account-risk-var"

export type LiquiditySeverity = "critical" | "warning" | "ok"

export interface ContractLiquidityAccount {
  account: string
  longLots: number
  shortLots: number
  netLots: number
}

export interface ContractLiquidity {
  contract: string
  product: string
  exchange: string
  netLots: number
  longLots: number
  shortLots: number
  positionMv: number
  margin: number
  volume: number | null
  openInterest: number | null
  participationRate: number | null
  oiConcentration: number | null
  severity: LiquiditySeverity
  warnings: string[]
  dataDate: string
  mktDate: string | null
  accounts: ContractLiquidityAccount[]
}

export function czceExpand(code: string): string {
  const m = code.match(/^([A-Z]{1,4})(\d)(\d{2})$/)
  if (!m) return code
  const yr = parseInt(m[2], 10)
  const thisYear = new Date().getFullYear()
  const decade = Math.floor(thisYear / 10)
  let fullYear = decade * 10 + yr
  if (fullYear < thisYear - 1) fullYear += 10
  return `${m[1]}${String(fullYear % 100).padStart(2, "0")}${m[3]}`
}

export function computeSeverityLevel(netLots: number, volume: number | null, hqoi: number | null): 0 | 1 | 2 {
  let maxLevel: 0 | 1 | 2 = 0
  if (volume !== null && volume > 0) {
    const pr = (netLots / volume) * 100
    if (pr >= 15) maxLevel = 2
    else if (pr >= 5) maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  } else if (volume === 0) {
    maxLevel = 2
  }
  if (hqoi !== null && hqoi > 0) {
    const oc = (netLots / hqoi) * 100
    if (oc >= 8) maxLevel = 2
    else if (oc >= 3) maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  }
  if (volume !== null && volume > 0 && volume < 200) maxLevel = 2
  else if (volume !== null && volume > 0 && volume < 1000) maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  if (volume === null && hqoi === null) maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  return maxLevel
}

function assessSeverity(netLots: number, volume: number | null, oi: number | null): {
  severity: LiquiditySeverity
  warnings: string[]
} {
  const warnings: string[] = []
  let maxLevel: 0 | 1 | 2 = 0
  if (volume !== null && volume > 0) {
    const partRate = (netLots / volume) * 100
    if (partRate >= 15) {
      warnings.push(`成交量占比 ${partRate.toFixed(1)}%（危险阈值 15%）`)
      maxLevel = 2
    } else if (partRate >= 5) {
      warnings.push(`成交量占比 ${partRate.toFixed(1)}%（警示阈值 5%）`)
      maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
    }
  } else if (volume === 0) {
    warnings.push("当日成交量为 0，合约可能已停止交易")
    maxLevel = 2
  }
  if (oi !== null && oi > 0) {
    const oiConc = (netLots / oi) * 100
    if (oiConc >= 8) {
      warnings.push(`持仓量占比 ${oiConc.toFixed(1)}%（危险阈值 8%）`)
      maxLevel = 2
    } else if (oiConc >= 3) {
      warnings.push(`持仓量占比 ${oiConc.toFixed(1)}%（警示阈值 3%）`)
      maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
    }
  } else if (oi === 0) {
    warnings.push("合约持仓量为 0")
    maxLevel = 2
  }
  if (volume !== null && volume > 0 && volume < 200) {
    warnings.push(`市场总成交量极低（${volume} 手），流动性严重不足`)
    maxLevel = 2
  } else if (volume !== null && volume > 0 && volume < 1000) {
    warnings.push(`市场总成交量偏低（${volume} 手）`)
    maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  }
  if (volume === null && oi === null) {
    warnings.push("未找到市场成交量/持仓量数据，流动性无法评估（可能为远期合约或数据缺失）")
    maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  }
  return { severity: maxLevel === 2 ? "critical" : maxLevel === 1 ? "warning" : "ok", warnings }
}

type PosAgg = {
  account: string
  date: string
  contract: string
  longLots: number
  shortLots: number
  positionMv: number
  margin: number
}

async function loadPositionAggs(fromDate?: string, exactDate?: string): Promise<PosAgg[]> {
  const params: unknown[] = [fromDate ?? null, exactDate ?? null]
  const result = await publicQuery(`
    SELECT account_no AS account,
           trade_date::text AS date,
           UPPER(TRIM(instrument)) AS contract,
           COALESCE(buy_lots, 0)::float8 AS buy_lots,
           COALESCE(sell_lots, 0)::float8 AS sell_lots,
           COALESCE(lots, 0)::float8 AS lots,
           bs,
           COALESCE(notional_mv, 0)::float8 AS mv,
           COALESCE(allocated_margin, 0)::float8 AS margin
    FROM public.cfmmc_positions
    WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
      AND ($1::date IS NULL OR trade_date >= $1::date)
      AND ($2::date IS NULL OR trade_date = $2::date)
      ${andScope(params)}
  `, params)

  const map = new Map<string, PosAgg>()
  for (const r of result.rows as {
    account: string; date: string; contract: string
    buy_lots: number; sell_lots: number; lots: number
    bs: string | null; mv: number; margin: number
  }[]) {
    if (!isFuturesInstrument(r.contract)) continue
    const contract = czceExpand(r.contract.split(".")[0] ?? r.contract)
    const buy = r.buy_lots || (r.bs === "买" ? r.lots : 0)
    const sell = r.sell_lots || (r.bs === "卖" ? r.lots : 0)
    if (buy <= 0 && sell <= 0) continue
    const key = `${r.date}|${r.account}|${contract}`
    const prev = map.get(key)
    if (prev) {
      prev.longLots += buy
      prev.shortLots += sell
      prev.positionMv += Math.abs(r.mv)
      prev.margin += r.margin
    } else {
      map.set(key, {
        account: r.account,
        date: r.date,
        contract,
        longLots: buy,
        shortLots: sell,
        positionMv: Math.abs(r.mv),
        margin: r.margin,
      })
    }
  }
  return [...map.values()]
}

async function loadMarketByDate(fromDate: string, toDate: string): Promise<{
  mktMap: Map<string, Map<string, { volume: number | null; hqoi: number | null }>>
  allMktDates: string[]
}> {
  const result = await publicQuery(`
    SELECT trade_date::date::text AS trade_date,
           UPPER(SPLIT_PART(TRIM(contract), '.', 1)) AS contract,
           MAX(volume)::text AS volume,
           MAX(hqoi)::text AS hqoi
    FROM public.raw_futures_contracts_daily
    WHERE trade_date >= $1::date AND trade_date <= $2::date
    GROUP BY 1, 2
  `, [fromDate, toDate]).catch(() => ({ rows: [] }))

  const mktMap = new Map<string, Map<string, { volume: number | null; hqoi: number | null }>>()
  for (const r of result.rows as { trade_date: string; contract: string; volume: string | null; hqoi: string | null }[]) {
    if (!mktMap.has(r.trade_date)) mktMap.set(r.trade_date, new Map())
    const cell = {
      volume: r.volume != null ? toNum(r.volume) : null,
      hqoi: r.hqoi != null ? toNum(r.hqoi) : null,
    }
    // Index both BU2609 and CZCE 3-digit forms so SR701 matches SR2701.CZC.
    mktMap.get(r.trade_date)!.set(r.contract, cell)
    mktMap.get(r.trade_date)!.set(czceExpand(r.contract), cell)
  }
  return { mktMap, allMktDates: [...mktMap.keys()].sort() }
}

function lookupMkt(
  mktMap: Map<string, Map<string, { volume: number | null; hqoi: number | null }>>,
  allMktDates: string[],
  posDate: string,
  contract: string,
): { volume: number | null; hqoi: number | null } | undefined {
  const keys = [contract, czceExpand(contract)]
  for (let i = allMktDates.length - 1; i >= 0; i--) {
    const d = allMktDates[i]
    if (d > posDate) continue
    const day = mktMap.get(d)
    if (!day) continue
    for (const k of keys) {
      const hit = day.get(k)
      if (hit && (hit.volume != null || hit.hqoi != null)) return hit
    }
  }
  return undefined
}

export async function buildLiquidityHistory(lookback: number): Promise<{
  ok: true
  data: { date: string; liqCritical: number; liqWarning: number }[]
}> {
  const fromParams: unknown[] = [lookback + 5]
  const fromExpr = await publicQuery(`
    SELECT (MAX(trade_date) - ($1 * INTERVAL '1 day'))::date::text AS d
    FROM public.cfmmc_positions
    WHERE ${scopeWhere(fromParams)}
  `, fromParams)
  const fromDate = (fromExpr.rows[0] as { d: string | null } | undefined)?.d
  if (!fromDate) return { ok: true, data: [] }

  const toParams: unknown[] = []
  const toExpr = await publicQuery(`SELECT MAX(trade_date)::date::text AS d FROM public.cfmmc_positions WHERE ${scopeWhere(toParams)}`, toParams)
  const toDate = (toExpr.rows[0] as { d: string | null } | undefined)?.d ?? fromDate

  const pos = await loadPositionAggs(fromDate)
  if (pos.length === 0) return { ok: true, data: [] }

  const mktStart = new Date(`${fromDate}T00:00:00Z`)
  mktStart.setUTCDate(mktStart.getUTCDate() - 40)
  const { mktMap, allMktDates } = await loadMarketByDate(mktStart.toISOString().slice(0, 10), toDate)
  const posByDate = new Map<string, Map<string, number>>()
  for (const r of pos) {
    const netLots = Math.abs(r.longLots - r.shortLots) || Math.max(r.longLots, r.shortLots)
    if (!posByDate.has(r.date)) posByDate.set(r.date, new Map())
    posByDate.get(r.date)!.set(r.contract, (posByDate.get(r.date)!.get(r.contract) ?? 0) + netLots)
  }

  const result: { date: string; liqCritical: number; liqWarning: number }[] = []
  for (const [posDate, contracts] of [...posByDate.entries()].sort()) {
    let critical = 0, warning = 0
    for (const [contract, netLots] of contracts) {
      const mkt = lookupMkt(mktMap, allMktDates, posDate, contract)
      const level = computeSeverityLevel(netLots, mkt?.volume ?? null, mkt?.hqoi ?? null)
      if (level === 2) critical++
      else if (level === 1) warning++
    }
    result.push({ date: posDate, liqCritical: critical, liqWarning: warning })
  }
  return { ok: true, data: result.slice(-lookback) }
}

export async function buildLiquidityScan(reqDate: string | null): Promise<{
  ok: true
  date: string | null
  contracts: ContractLiquidity[]
  summary: {
    total: number
    critical: number
    warning: number
    ok: number
    noMktData: number
    noMktContracts: string[]
  } | null
  mktDate: string | null
  notYetRun?: boolean
}> {
  const latestParams: unknown[] = []
  const latest = await publicQuery(`SELECT MAX(trade_date)::date::text AS d FROM public.cfmmc_positions WHERE ${scopeWhere(latestParams)}`, latestParams)
  const latestDate = (latest.rows[0] as { d: string | null } | undefined)?.d
  if (!latestDate) {
    return { ok: true, date: null, contracts: [], summary: null, mktDate: null, notYetRun: true }
  }

  const posDate = reqDate ?? latestDate
  const pos = await loadPositionAggs(undefined, posDate)
  if (pos.length === 0) {
    return { ok: true, date: posDate, contracts: [], summary: null, mktDate: null }
  }

  const from = new Date(`${posDate}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - 70)
  const { mktMap, allMktDates } = await loadMarketByDate(from.toISOString().slice(0, 10), posDate)
  const mktDate = allMktDates.filter((d) => d <= posDate).at(-1) ?? null

  const contractMap = new Map<string, {
    contract: string
    longLots: number
    shortLots: number
    positionMv: number
    margin: number
    accounts: Map<string, { longLots: number; shortLots: number }>
  }>()
  for (const r of pos) {
    const existing = contractMap.get(r.contract)
    if (existing) {
      existing.longLots += r.longLots
      existing.shortLots += r.shortLots
      existing.positionMv += r.positionMv
      existing.margin += r.margin
    } else {
      contractMap.set(r.contract, {
        contract: r.contract,
        longLots: r.longLots,
        shortLots: r.shortLots,
        positionMv: r.positionMv,
        margin: r.margin,
        accounts: new Map(),
      })
    }
    const acctMap = contractMap.get(r.contract)!.accounts
    const acct = acctMap.get(r.account)
    if (acct) {
      acct.longLots += r.longLots
      acct.shortLots += r.shortLots
    } else {
      acctMap.set(r.account, { longLots: r.longLots, shortLots: r.shortLots })
    }
  }

  const contracts: ContractLiquidity[] = []
  for (const [contract, posRow] of contractMap) {
    const netLots = Math.abs(posRow.longLots - posRow.shortLots) || Math.max(posRow.longLots, posRow.shortLots)
    const mkt = lookupMkt(mktMap, allMktDates, posDate, contract)
    const volume = mkt?.volume ?? null
    const oi = mkt?.hqoi ?? null
    const participationRate = volume != null && volume > 0 ? (netLots / volume) * 100 : null
    const oiConcentration = oi != null && oi > 0 ? (netLots / oi) * 100 : null
    const { severity, warnings } = assessSeverity(netLots, volume, oi)
    const accounts = [...posRow.accounts.entries()]
      .map(([account, a]) => ({
        account,
        longLots: Math.round(a.longLots),
        shortLots: Math.round(a.shortLots),
        netLots: Math.round(Math.abs(a.longLots - a.shortLots) || Math.max(a.longLots, a.shortLots)),
      }))
      .sort((a, b) => b.netLots - a.netLots)
    contracts.push({
      contract,
      product: getPrefix(contract),
      exchange: "",
      netLots,
      longLots: Math.round(posRow.longLots),
      shortLots: Math.round(posRow.shortLots),
      positionMv: Math.round(posRow.positionMv),
      margin: Math.round(posRow.margin),
      volume,
      openInterest: oi,
      participationRate: participationRate != null ? Math.round(participationRate * 100) / 100 : null,
      oiConcentration: oiConcentration != null ? Math.round(oiConcentration * 100) / 100 : null,
      severity,
      warnings,
      dataDate: posDate,
      mktDate,
      accounts,
    })
  }

  contracts.sort((a, b) => {
    const sOrder = { critical: 0, warning: 1, ok: 2 }
    const sd = sOrder[a.severity] - sOrder[b.severity]
    if (sd !== 0) return sd
    return (b.participationRate ?? 0) - (a.participationRate ?? 0)
  })

  const noMktList = contracts.filter((c) => c.volume === null).map((c) => c.contract)
  return {
    ok: true,
    date: posDate,
    contracts,
    mktDate,
    summary: {
      total: contracts.length,
      critical: contracts.filter((c) => c.severity === "critical").length,
      warning: contracts.filter((c) => c.severity === "warning").length,
      ok: contracts.filter((c) => c.severity === "ok").length,
      noMktData: noMktList.length,
      noMktContracts: noMktList,
    },
  }
}
