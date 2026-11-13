/**
 * Read-only view of the MOM 日间风控 report.
 * Calls the existing mom-analysis handlers and returns the numbers the page shows.
 * Does not write public.mom_* and does not change those handlers.
 */

import { PROD_NAMES, PROD_SECTOR } from "@/lib/ma/prod-sector"
import { momDataErr, momDataOk, type MomDataEnvelope } from "@/lib/server/mom-data-api"
import { varConcentrationShares } from "@/lib/mom-var-concentration"

type SandboxProduct = { prod: string; mv: number; lots: number; sigma: number }

function intParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function categoryOf(code: string): string {
  const sector = PROD_SECTOR[code]
  if (sector === "股指" || sector === "国债") return sector
  return "商品"
}

function isoDate(value: string | undefined): string | null {
  const text = (value ?? "").trim()
  if (!text) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function historyRequested(record: Record<string, string | undefined>): boolean {
  const flag = (record.history ?? "").trim().toLowerCase()
  return flag === "1" || flag === "true" || Boolean((record.start_date ?? "").trim()) || Boolean((record.end_date ?? "").trim())
}

function windowByDate<T extends { date: string | null }>(
  rows: T[],
  record: Record<string, string | undefined>,
  defaultLimit: number,
): { error: string } | { history: { start_date: string | null; end_date: string | null; total: number; truncated: boolean; rows: T[] } } {
  const start = record.start_date ? isoDate(record.start_date) : null
  const end = record.end_date ? isoDate(record.end_date) : null
  if (record.start_date && !start) return { error: "start_date must be YYYY-MM-DD" }
  if (record.end_date && !end) return { error: "end_date must be YYYY-MM-DD" }
  if (start && end && start > end) return { error: "start_date must be on or before end_date" }
  const filtered = rows.filter((row) => {
    if (!row.date) return false
    if (start && row.date < start) return false
    if (end && row.date > end) return false
    return true
  })
  const limit = intParam(record.limit, defaultLimit, 1, 2000)
  const truncated = filtered.length > limit
  const page = truncated ? filtered.slice(filtered.length - limit) : filtered
  return {
    history: {
      start_date: page[0]?.date ?? null,
      end_date: page[page.length - 1]?.date ?? null,
      total: filtered.length,
      truncated,
      rows: page,
    },
  }
}

async function readRoute(loader: () => Promise<(req: Request) => Promise<Response>>, url: string): Promise<Record<string, unknown>> {
  const GET = await loader()
  const res = await GET(new Request(url))
  const body = await res.json()
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "empty response" }
  }
  return body as Record<string, unknown>
}

export async function getMomRiskVar(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const confidence = record.confidence === "90" || record.confidence === "99" ? record.confidence : "95"
  const volDays = intParam(record.vol_days ?? record.volDays, 20, 5, 120)
  const corrDays = intParam(record.corr_days ?? record.corrDays, 252, 5, 756)
  const dist = record.dist === "t" || record.dist === "laplace" || record.dist === "logistic" ? record.dist : "normal"
  const qs = new URLSearchParams({
    confidence,
    volDays: String(volDays),
    corrDays: String(corrDays),
    distModel: dist,
  })
  const json = await readRoute(
    () => import("@/app/ma/api/mom-analysis/var-sandbox/route").then((mod) => mod.GET),
    `http://localhost/ma/api/mom-analysis/var-sandbox?${qs}`,
  )
  if (json.ok === false) return momDataErr(3, String(json.error || "var sandbox failed"))

  const products = (Array.isArray(json.products) ? json.products : []) as SandboxProduct[]
  const corr = (Array.isArray(json.corrMatrix) ? json.corrMatrix : []) as number[][]
  const z = typeof json.zScore === "number" ? json.zScore : 1.6449
  const dv = products.map((product) => product.sigma * product.mv)
  let portVar = 0
  for (let i = 0; i < dv.length; i += 1) {
    if (dv[i] === 0) continue
    for (let j = 0; j < dv.length; j += 1) {
      if (dv[j] === 0) continue
      portVar += dv[i] * dv[j] * (corr[i]?.[j] ?? 0)
    }
  }
  const sigmaP = portVar > 0 ? Math.sqrt(portVar) : 0
  const totalVar = typeof json.totalVar === "number" ? json.totalVar : (sigmaP > 0 ? Math.round(z * sigmaP) : 0)
  const mvc = products.map((product, index) => {
    let covSum = 0
    for (let j = 0; j < dv.length; j += 1) covSum += dv[j] * (corr[index]?.[j] ?? 0)
    return dv[index] * covSum
  })
  const absTotal = mvc.reduce((sum, value) => sum + Math.abs(value), 0)
  const shares = varConcentrationShares(products, corr)
  const shareByCode = new Map(shares.products.map((item) => [item.name, item.pct]))

  const rows = products.map((product, index) => ({
    code: product.prod,
    name: PROD_NAMES[product.prod] ?? null,
    sector: PROD_SECTOR[product.prod] ?? "其他",
    category: categoryOf(product.prod),
    direction: product.mv > 0 ? "long" : product.mv < 0 ? "short" : "flat",
    market_value: Math.round(product.mv),
    lots: product.lots,
    marginal_pct: round2(shareByCode.get(product.prod) ?? (absTotal > 0 ? (Math.abs(mvc[index]) / absTotal) * 100 : 0)),
    component_var: sigmaP > 0 ? Math.round((z * mvc[index]) / sigmaP) : 0,
  })).sort((a, b) => b.marginal_pct - a.marginal_pct)

  let cumCapital: number | null = null
  try {
    const nav = await readRoute(
      () => import("@/app/ma/api/mom-analysis/product-nav/route").then((mod) => mod.GET),
      "http://localhost/ma/api/mom-analysis/product-nav",
    )
    const series = Array.isArray(nav.data) ? nav.data : []
    const last = series[series.length - 1] as { cumCapital?: number } | undefined
    if (last && typeof last.cumCapital === "number") cumCapital = last.cumCapital
  } catch {
    cumCapital = null
  }

  return momDataOk({
    date: typeof json.date === "string" ? json.date.slice(0, 10) : null,
    method: "parametric",
    horizon: "1d",
    confidence: Number(confidence),
    z_score: z,
    vol_days: volDays,
    corr_days: corrDays,
    dist,
    total_var: totalVar,
    net_market_value: rows.reduce((sum, row) => sum + row.market_value, 0),
    cum_capital: cumCapital,
    var_to_capital_pct: cumCapital && cumCapital > 0 ? round2((totalVar / cumCapital) * 100) : null,
    products: rows,
    sectors: shares.sectors.map((item) => ({ name: item.name, marginal_pct: round2(item.pct) })),
    note: "与日间风控 VaR 沙盒同一口径：持仓市值 × 历史波动，经相关性汇总。金额为正的 total_var 是组合 1 日 VaR。component_var 是分到该品种的金额，正负相加等于 total_var。marginal_pct 是饼图上的边际波动贡献占比。",
  })
}

export async function getMomRiskMargin(record: Record<string, string | undefined> = {}): Promise<MomDataEnvelope<unknown>> {
  const json = await readRoute(
    () => import("@/app/ma/api/mom-analysis/margin-risk/route").then((mod) => mod.GET),
    "http://localhost/ma/api/mom-analysis/margin-risk",
  )
  if (json.ok === false) return momDataErr(3, String(json.error || "margin risk failed"))
  const series = (Array.isArray(json.timeseries) ? json.timeseries : []) as Array<Record<string, unknown>>
  const latest = series[series.length - 1] ?? null
  const accounts = (Array.isArray(json.latest) ? json.latest : []) as Array<Record<string, unknown>>
  const point = (row: Record<string, unknown> | null) => row ? {
    date: typeof row.date === "string" ? row.date.slice(0, 10) : null,
    margin: row.margin ?? null,
    equity: row.equity ?? null,
    available: row.available ?? null,
    fund_nav: row.fundNav ?? null,
    risk_ratio: row.riskRatio ?? null,
    long_margin_ratio: row.longMarginRatio ?? null,
    short_margin_ratio: row.shortMarginRatio ?? null,
  } : null
  let history: unknown = null
  if (historyRequested(record)) {
    const account = (record.account ?? "").trim()
    const source = account
      ? (((Array.isArray(json.accounts) ? json.accounts : []) as Array<Record<string, unknown>>)
          .find((row) => String(row.account ?? "") === account)?.series as Array<Record<string, unknown>> | undefined) ?? []
      : series
    const dated = source.map((row) => point(row)).filter((row): row is NonNullable<typeof row> => row != null)
    const windowed = windowByDate(dated, record, 250)
    if ("error" in windowed) return momDataErr(1, windowed.error)
    history = account ? { account, ...windowed.history } : windowed.history
    if (account && dated.length === 0) return momDataErr(2, "account not found in margin history")
  }
  return momDataOk({
    portfolio: point(latest),
    accounts: accounts.map((row) => ({
      account: row.account ?? null,
      date: typeof row.date === "string" ? row.date.slice(0, 10) : null,
      margin: row.margin ?? null,
      equity: row.equity ?? null,
      available: row.available ?? null,
      risk_ratio: row.riskRatio ?? null,
    })),
    history,
    note: "与日间风控「风险水平（保证金）」同一口径。risk_ratio 是保证金 / 基金净值 × 100，单位是百分点。历史来自已入库的每日核算，不是单独的结果表。不传 history、start_date、end_date 时 history 为 null。传 history=1 返回组合曲线，默认最近 250 个交易日；再传 account 则换成该资金账号的曲线。",
  })
}

export async function getMomRiskVarForecast(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const confidence = record.confidence === "90" || record.confidence === "99" ? record.confidence : "95"
  const volDays = intParam(record.vol_days ?? record.volDays, 20, 5, 120)
  const corrDays = intParam(record.corr_days ?? record.corrDays, 252, 5, 756)
  const dist = record.dist === "t" || record.dist === "laplace" || record.dist === "logistic" || record.dist === "kde"
    ? record.dist
    : "normal"
  const qs = new URLSearchParams({
    confidence,
    volDays: String(volDays),
    corrDays: String(corrDays),
    distModel: dist,
  })
  const json = await readRoute(
    () => import("@/app/ma/api/mom-analysis/var-prediction/route").then((mod) => mod.GET),
    `http://localhost/ma/api/mom-analysis/var-prediction?${qs}`,
  )
  if (json.ok === false) return momDataErr(3, String(json.error || "var forecast failed"))
  const history = (Array.isArray(json.data) ? json.data : []) as Array<{ date?: string; var?: number; actual?: number }>
  const last = history[history.length - 1]
  const dated = history.map((row) => ({
    date: typeof row.date === "string" ? row.date.slice(0, 10) : null,
    var: row.var ?? null,
    actual_pnl: row.actual ?? null,
  }))
  let series: unknown = null
  if (historyRequested(record)) {
    const windowed = windowByDate(dated, record, 180)
    if ("error" in windowed) return momDataErr(1, windowed.error)
    series = windowed.history
  }
  return momDataOk({
    next_day_var: typeof json.nextDayVar === "number" ? json.nextDayVar : null,
    breach_rate: typeof json.breachRate === "number" ? json.breachRate : null,
    not_enough_data: json.notEnoughData === true || json.notYetRun === true,
    confidence: Number(confidence),
    vol_days: volDays,
    corr_days: corrDays,
    dist,
    latest: last ? {
      date: typeof last.date === "string" ? last.date.slice(0, 10) : null,
      var: last.var ?? null,
      actual_pnl: last.actual ?? null,
    } : null,
    history: series,
    note: "与日间风控「次日预测」同一口径。next_day_var 是用最近一个交易日持仓估计的下一交易日 1 日 VaR。库里没有 VaR 结果表；回测用每日持仓现算，页面只保留最近约 180 个交易日。传 history=1 或 start_date、end_date 才返回这段 history。",
  })
}

export async function getMomRiskMarginal(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const volDays = intParam(record.vol_days ?? record.volDays, 20, 5, 120)
  const corrDays = intParam(record.corr_days ?? record.corrDays, 252, 5, 756)
  const group = record.group === "category" || record.group === "sub" ? record.group : "sector"
  const qs = new URLSearchParams({ volDays: String(volDays), corrDays: String(corrDays) })
  const json = await readRoute(
    () => import("@/app/ma/api/mom-analysis/var-sector-timeseries/route").then((mod) => mod.GET),
    `http://localhost/ma/api/mom-analysis/var-sector-timeseries?${qs}`,
  )
  if (json.ok === false) return momDataErr(3, String(json.error || "marginal history failed"))
  const dates = (Array.isArray(json.dates) ? json.dates : []) as string[]
  const column = group === "category" ? json.catData : group === "sub" ? json.subSectorData : json.sectorData
  const data = (column && typeof column === "object" && !Array.isArray(column) ? column : {}) as Record<string, number[]>
  const rows = dates.map((date, index) => ({
    date: date.slice(0, 10),
    shares: Object.entries(data)
      .map(([name, values]) => ({ name, pct: round2(Number(values?.[index] ?? 0)) }))
      .filter((item) => item.pct > 0)
      .sort((a, b) => b.pct - a.pct),
  }))
  const windowed = windowByDate(rows, record, 120)
  if ("error" in windowed) return momDataErr(1, windowed.error)
  return momDataOk({
    group,
    vol_days: volDays,
    corr_days: corrDays,
    ...windowed.history,
    note: "与持仓分析里「板块边际波动贡献」历史曲线同一口径，也就是 VaR 沙盒饼图按交易日展开。用每日持仓现算，不是入库的结果表。group=sector（默认）、category 或 sub。默认最近 120 个交易日，用 start_date、end_date、limit 收窄。",
  })
}
