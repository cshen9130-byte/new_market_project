export type ExposureMetric = "risk" | "equity"

export type SignalKind =
  | "consensus_long"
  | "consensus_short"
  | "divergence"
  | "quant_only"
  | "subj_only"
  | "neutral"

export type ActionKind =
  | "加码"
  | "暂缓加码"
  | "减码准备"
  | "观望"
  | "补风格"
  | "控拥挤"
  | "扩容"

export type DecisionAction = ActionKind | "中性"

export type DecisionKind = SignalKind | "crowded" | "allocation"

export interface RowDecision {
  kind: DecisionKind
  action: DecisionAction
}

export interface SleevePct {
  riskPctGroup: number
  equityPctGroup: number
  riskPctBook: number
  equityPctBook: number
}

export interface SignalSourceRow {
  key: string
  name: string
  sector?: string
  quant: SleevePct
  subjective: SleevePct
}

export type FlowKind = "both_add" | "both_cut" | "diverge" | "one_sided" | "flat"

export type MarginTag =
  | "同向加仓"
  | "同向减仓"
  | "边际背离"
  | "分歧收敛"
  | "分歧加剧"
  | "一侧变动"
  | "变化很小"

export type CutPnlKind = "止损撤退" | "获利了结" | null

export interface AccountFlowCell {
  account: string
  trade: number
}

export interface SleeveFlow {
  trade1d: number
  trade5d: number
  price1d: number
  prevNet: number
  todayNet: number
  addAccounts: number
  cutAccounts: number
  flatAccounts: number
  nAccounts: number
  cells?: AccountFlowCell[]
}

export interface RowFlow {
  quant: SleeveFlow
  subjective: SleeveFlow
}

export interface FlowView {
  kind1d: FlowKind
  kind5d: FlowKind
  tag: MarginTag
  cutPnl: CutPnlKind
  q1d: number
  s1d: number
  q5d: number
  s5d: number
  qPrice1d: number
  sPrice1d: number
  qLive1: boolean
  sLive1: boolean
  quantBreadth: { add: number; cut: number; flat: number; total: number }
  subjBreadth: { add: number; cut: number; flat: number; total: number }
  quantCells: AccountFlowCell[]
}

export interface MomSignal {
  level: "sector" | "product" | "allocation"
  key: string
  name: string
  type: SignalKind | "crowded" | "allocation"
  action: DecisionAction
  title: string
  detail: string
  strength: number
  flow?: FlowView
  quantPct?: number
  subjPct?: number
}

export const MOM_SECTORS = ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债"] as const

export function emptySleevePct(): SleevePct {
  return { riskPctGroup: 0, equityPctGroup: 0, riskPctBook: 0, equityPctBook: 0 }
}

/** Fill missing canonical sectors so the briefing table always has one row per 板块. */
export function completeSectorRows(sectors: SignalSourceRow[]): SignalSourceRow[] {
  const byKey = new Map(sectors.map((r) => [r.key, r]))
  return MOM_SECTORS.map((name) => byKey.get(name) ?? {
    key: name,
    name,
    quant: emptySleevePct(),
    subjective: emptySleevePct(),
  })
}

export type FlowMap = Record<string, RowFlow>

export interface HoldingPos {
  longMv: number
  shortMv: number
  longLots: number
  shortLots: number
}

export interface FlowGridSource {
  dates: string[]
  products: { code: string; sector: string }[]
  quantLong: number[][]
  quantShort: number[][]
  quantLongLots: number[][]
  quantShortLots: number[][]
  subjLong: number[][]
  subjShort: number[][]
  subjLongLots: number[][]
  subjShortLots: number[][]
}

const CONSENSUS_MIN = 3
const HEAVY_MIN = 8
const LIGHT_MAX = 1.5
const CROWD_SUM = 25
const FLOW_MIN_ABS = 1_000_000
const FLOW_REL = 0.05
const FLOW_SCALE_FLOOR = 2_000_000
const ACCT_FLOW_MIN = 200_000

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function exposurePct(s: SleevePct, metric: ExposureMetric): number {
  return metric === "risk" ? (s.riskPctGroup ?? 0) : (s.equityPctGroup ?? 0)
}

export function bookExposurePct(s: SleevePct, metric: ExposureMetric): number {
  return metric === "risk" ? (s.riskPctBook ?? 0) : (s.equityPctBook ?? 0)
}

export function classifyExposure(
  q: SleevePct,
  s: SleevePct,
  metric: ExposureMetric,
): { signal: SignalKind; consensusScore: number } {
  const qn = exposurePct(q, metric)
  const sn = exposurePct(s, metric)
  const aq = Math.abs(qn)
  const as_ = Math.abs(sn)
  const sameDir = (qn > 0 && sn > 0) || (qn < 0 && sn < 0)
  const minAbs = Math.min(aq, as_)
  const signed = sameDir ? Math.sign(qn || sn) * minAbs : -minAbs
  const consensusScore = round1(signed)

  if (sameDir && aq >= CONSENSUS_MIN && as_ >= CONSENSUS_MIN) {
    return { signal: qn > 0 ? "consensus_long" : "consensus_short", consensusScore }
  }
  if (!sameDir && aq >= CONSENSUS_MIN && as_ >= CONSENSUS_MIN) {
    return { signal: "divergence", consensusScore }
  }
  if (aq >= HEAVY_MIN && as_ < LIGHT_MAX) return { signal: "quant_only", consensusScore }
  if (as_ >= HEAVY_MIN && aq < LIGHT_MAX) return { signal: "subj_only", consensusScore }
  return { signal: "neutral", consensusScore }
}

export function emptySleeveFlow(): SleeveFlow {
  return {
    trade1d: 0,
    trade5d: 0,
    price1d: 0,
    prevNet: 0,
    todayNet: 0,
    addAccounts: 0,
    cutAccounts: 0,
    flatAccounts: 0,
    nAccounts: 0,
  }
}

export function lotsPrice(pos: HoldingPos): number {
  const lots = Math.abs(pos.longLots) + Math.abs(pos.shortLots)
  const mv = Math.abs(pos.longMv) + Math.abs(pos.shortMv)
  return lots > 1e-9 ? mv / lots : 0
}

export function decomposeNet(prev: HoldingPos, today: HoldingPos): {
  prevNet: number
  todayNet: number
  trade: number
  price: number
} {
  const prevNet = prev.longMv - prev.shortMv
  const todayNet = today.longMv - today.shortMv
  const dLots = (today.longLots - today.shortLots) - (prev.longLots - prev.shortLots)
  const px = lotsPrice(today) || lotsPrice(prev)
  const trade = dLots * px
  return { prevNet, todayNet, trade, price: todayNet - prevNet - trade }
}

export function flowIsLive(trade: number, prevNet: number, todayNet: number, minAbs = FLOW_MIN_ABS): boolean {
  const base = Math.max(Math.abs(prevNet), Math.abs(todayNet), FLOW_SCALE_FLOOR)
  return Math.abs(trade) >= Math.max(minAbs, FLOW_REL * base)
}

function ownAligned(trade: number, stock: number): number {
  return trade * (stock < 0 ? -1 : 1)
}

function sleeveCutting(trade: number, stock: number): boolean {
  return (stock >= 0 && trade < 0) || (stock < 0 && trade > 0)
}

function sleeveLost(price: number, stock: number): boolean {
  return (stock >= 0 && price < 0) || (stock < 0 && price > 0)
}

function kindFromTrades(
  qTrade: number,
  sTrade: number,
  qLive: boolean,
  sLive: boolean,
  dir: number,
): FlowKind {
  if (!qLive && !sLive) return "flat"
  if (!qLive || !sLive) return "one_sided"
  if (Math.sign(qTrade) === Math.sign(sTrade) && qTrade !== 0) {
    return qTrade * dir > 0 ? "both_add" : "both_cut"
  }
  return "diverge"
}

export function classifyRowFlow(qStock: number, sStock: number, flow: RowFlow): FlowView {
  const q1 = flow.quant.trade1d
  const s1 = flow.subjective.trade1d
  const q5 = flow.quant.trade5d
  const s5 = flow.subjective.trade5d
  const qLive1 = flowIsLive(q1, flow.quant.prevNet, flow.quant.todayNet)
  const sLive1 = flowIsLive(s1, flow.subjective.prevNet, flow.subjective.todayNet)
  const qPrev5 = flow.quant.todayNet - q5
  const sPrev5 = flow.subjective.todayNet - s5
  const qLive5 = flowIsLive(q5, qPrev5, flow.quant.todayNet)
  const sLive5 = flowIsLive(s5, sPrev5, flow.subjective.todayNet)
  const sameStock = (qStock > 0 && sStock > 0) || (qStock < 0 && sStock < 0)
  const dir = qStock + sStock < 0 ? -1 : 1
  const kind1d = kindFromTrades(q1, s1, qLive1, sLive1, dir)
  const kind5d = kindFromTrades(q5, s5, qLive5, sLive5, dir)

  let tag: MarginTag
  if (sameStock) {
    if (kind1d === "both_add") tag = "同向加仓"
    else if (kind1d === "both_cut") tag = "同向减仓"
    else if (kind1d === "diverge") tag = "边际背离"
    else if (kind1d === "one_sided") tag = "一侧变动"
    else tag = "变化很小"
  } else {
    const qOwn = ownAligned(q1, qStock)
    const sOwn = ownAligned(s1, sStock)
    if (kind1d === "flat") tag = "变化很小"
    else if (qLive1 && sLive1 && qOwn < 0 && sOwn < 0) tag = "分歧收敛"
    else if (qLive1 && sLive1 && qOwn > 0 && sOwn > 0) tag = "分歧加剧"
    else if (kind1d === "diverge") tag = "分歧加剧"
    else tag = "一侧变动"
  }

  const qCutLive = qLive1 && sleeveCutting(q1, qStock)
  const sCutLive = sLive1 && sleeveCutting(s1, sStock)
  let cutPnl: CutPnlKind = null
  if (qCutLive || sCutLive) {
    const useQ = qCutLive && (!sCutLive || Math.abs(q1) >= Math.abs(s1))
    const lost = useQ ? sleeveLost(flow.quant.price1d, qStock) : sleeveLost(flow.subjective.price1d, sStock)
    cutPnl = lost ? "止损撤退" : "获利了结"
  }

  return {
    kind1d,
    kind5d,
    tag,
    cutPnl,
    q1d: q1,
    s1d: s1,
    q5d: q5,
    s5d: s5,
    qPrice1d: flow.quant.price1d,
    sPrice1d: flow.subjective.price1d,
    qLive1,
    sLive1,
    quantBreadth: {
      add: flow.quant.addAccounts,
      cut: flow.quant.cutAccounts,
      flat: flow.quant.flatAccounts,
      total: flow.quant.nAccounts,
    },
    subjBreadth: {
      add: flow.subjective.addAccounts,
      cut: flow.subjective.cutAccounts,
      flat: flow.subjective.flatAccounts,
      total: flow.subjective.nAccounts,
    },
    quantCells: flow.quant.cells ?? [],
  }
}

export function consensusActionWithFlow(crowded: boolean, flow: FlowView | null): ActionKind {
  if (crowded) return "控拥挤"
  if (!flow) return "加码"
  const f1 = flow.kind1d
  const f5 = flow.kind5d
  if (f1 === "diverge") return f5 === "both_add" ? "加码" : "暂缓加码"
  if (f1 === "both_cut") return f5 === "both_add" ? "加码" : "减码准备"
  if (f1 === "both_add") return "加码"
  if (f5 === "diverge") return "暂缓加码"
  if (f5 === "both_cut") return "减码准备"
  return "加码"
}

/** 今−昨 signed risk%, rounded to the table’s 0.1%. */
export function signedPctDelta(today: number, yesterday: number): number {
  return round1(today) - round1(yesterday)
}

/** 边际 from the 量化今/昨 · 主观今/昨 numbers (not lot trades). */
export function classifyPctDelta(
  qToday: number,
  qYest: number,
  sToday: number,
  sYest: number,
): { tag: MarginTag; kind1d: FlowKind } {
  const dq = signedPctDelta(qToday, qYest)
  const ds = signedPctDelta(sToday, sYest)
  const qLive = dq !== 0
  const sLive = ds !== 0
  const sameStock = (qToday > 0.15 && sToday > 0.15) || (qToday < -0.15 && sToday < -0.15)
  const dir = qToday + sToday < 0 ? -1 : 1

  if (!qLive && !sLive) return { tag: "变化很小", kind1d: "flat" }
  if (!qLive || !sLive) return { tag: "一侧变动", kind1d: "one_sided" }

  if (sameStock) {
    if (Math.sign(dq) === Math.sign(ds)) {
      return dq * dir > 0
        ? { tag: "同向加仓", kind1d: "both_add" }
        : { tag: "同向减仓", kind1d: "both_cut" }
    }
    return { tag: "边际背离", kind1d: "diverge" }
  }

  const qOwn = dq * (qToday < 0 ? -1 : 1)
  const sOwn = ds * (sToday < 0 ? -1 : 1)
  if (qOwn < 0 && sOwn < 0) return { tag: "分歧收敛", kind1d: "both_cut" }
  if (qOwn > 0 && sOwn > 0) return { tag: "分歧加剧", kind1d: "diverge" }
  return { tag: "分歧加剧", kind1d: "diverge" }
}

export function consensusActionFromPctKind(kind: FlowKind, fallback: DecisionAction): DecisionAction {
  if (fallback !== "加码" && fallback !== "暂缓加码" && fallback !== "减码准备") return fallback
  if (kind === "diverge") return "暂缓加码"
  if (kind === "both_cut") return "减码准备"
  if (kind === "both_add") return "加码"
  return fallback
}

export function applyPctMargin(
  signal: MomSignal,
  prev: { q: number; s: number } | undefined,
): MomSignal {
  if (!prev || signal.quantPct == null || signal.subjPct == null) return signal
  const { tag, kind1d } = classifyPctDelta(signal.quantPct, prev.q, signal.subjPct, prev.s)
  return {
    ...signal,
    action: consensusActionFromPctKind(kind1d, signal.action),
    flow: signal.flow ? { ...signal.flow, tag, kind1d, cutPnl: null } : signal.flow,
  }
}

export function pctChangeLines(
  qToday: number,
  qYest: number,
  sToday: number,
  sYest: number,
): string[] {
  const line = (today: number, yest: number, sleeve: string) => {
    const d = signedPctDelta(today, yest)
    if (d === 0) return null
    const dir = today < -0.15 || (Math.abs(today) <= 0.15 && yest < -0.15) ? "空" : "多"
    const add = dir === "空" ? d < 0 : d > 0
    return `${sleeve}${add ? "加" : "减"}${dir}`
  }
  return [line(qToday, qYest, "量化"), line(sToday, sYest, "主观")].filter((x): x is string => Boolean(x))
}

export function lookupFlow(flows: FlowMap | undefined, level: string, key: string): RowFlow | undefined {
  if (!flows) return undefined
  return flows[signalRowKey(level, key)]
}

/** Action + kind for one sector/product row. Includes 中性 (unlike buildMomSignals). */
export function rowDecision(
  quant: SleevePct,
  subjective: SleevePct,
  metric: ExposureMetric,
  flow?: RowFlow | null,
): RowDecision {
  const { signal } = classifyExposure(quant, subjective, metric)
  const q = exposurePct(quant, metric)
  const s = exposurePct(subjective, metric)
  const aq = Math.abs(q)
  const as_ = Math.abs(s)
  const fv = flow ? classifyRowFlow(q, s, flow) : null
  if (signal === "consensus_long" || signal === "consensus_short") {
    if (aq + as_ >= CROWD_SUM) return { kind: "crowded", action: "控拥挤" }
    return { kind: signal, action: consensusActionWithFlow(false, fv) }
  }
  if (signal === "divergence") return { kind: signal, action: "观望" }
  if (signal === "quant_only" || signal === "subj_only") return { kind: signal, action: "补风格" }
  return { kind: "neutral", action: "中性" }
}

export function signalKindLabel(kind: DecisionKind): string {
  switch (kind) {
    case "consensus_long": return "共识做多"
    case "consensus_short": return "共识做空"
    case "divergence": return "方向分歧"
    case "quant_only": return "仅量化"
    case "subj_only": return "仅主观"
    case "crowded": return "共识但拥挤"
    case "allocation": return "资金配置"
    default: return "中性"
  }
}

export type StrengthTier = "强" | "中" | "弱"

export function rowStrength(
  quant: SleevePct,
  subjective: SleevePct,
  metric: ExposureMetric,
  flow?: RowFlow | null,
): number {
  const { signal } = classifyExposure(quant, subjective, metric)
  const q = exposurePct(quant, metric)
  const s = exposurePct(subjective, metric)
  const aq = Math.abs(q)
  const as_ = Math.abs(s)
  const book = Math.abs(bookExposurePct(quant, metric)) + Math.abs(bookExposurePct(subjective, metric))
  const action = rowDecision(quant, subjective, metric, flow).action
  if (signal === "consensus_long" || signal === "consensus_short") {
    if (action === "控拥挤" || aq + as_ >= CROWD_SUM) return Math.min(100, round1(aq + as_ + book))
    if (action === "暂缓加码") return Math.min(100, round1(Math.min(aq, as_) * 1.5 + book))
    if (action === "减码准备") return Math.min(100, round1(Math.min(aq, as_) + book * 0.6))
    if (aq >= HEAVY_MIN && as_ >= HEAVY_MIN) return Math.min(100, round1(Math.min(aq, as_) * 2 + book))
    return Math.min(100, round1(Math.min(aq, as_) + book * 0.5))
  }
  if (signal === "divergence") return Math.min(100, round1(Math.min(aq, as_) * 1.5 + book))
  if (signal === "quant_only") return Math.min(100, round1(aq + book))
  if (signal === "subj_only") return Math.min(100, round1(as_ + book))
  return Math.min(100, round1(Math.max(aq, as_)))
}

export function strengthTier(strength: number): StrengthTier {
  if (strength >= 20) return "强"
  if (strength >= 8) return "中"
  return "弱"
}

export function fmtFlowYuan(n: number): string {
  const abs = Math.abs(n)
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`
  if (abs === 0) return "0"
  return `${sign}${abs.toFixed(0)}`
}

export function flowSummaryLine(fv: FlowView): string {
  return `1日 量化 ${fmtFlowYuan(fv.q1d)}、主观 ${fmtFlowYuan(fv.s1d)}；5日 量化 ${fmtFlowYuan(fv.q5d)}、主观 ${fmtFlowYuan(fv.s5d)}`
}

export function exposureDirLabel(pct: number): string {
  if (pct > 0.15) return `多${pct.toFixed(1)}%`
  if (pct < -0.15) return `空${Math.abs(pct).toFixed(1)}%`
  return `平${pct.toFixed(1)}%`
}

function flowSentence(fv: FlowView | null, unit: string): string {
  if (!fv || fv.tag === "变化很小") return ""
  const cut = fv.cutPnl ? `减仓侧偏${fv.cutPnl}。` : ""
  if (fv.tag === "边际背离") {
    return `方向仍一致，但主动调仓反向（${flowSummaryLine(fv)}）。${cut}暂不加该${unit} beta。`
  }
  if (fv.tag === "同向减仓") {
    return `两侧都在减该方向（${flowSummaryLine(fv)}）。${cut}先准备减码，而不是加暴露。`
  }
  if (fv.tag === "同向加仓") {
    return `两侧都在加该方向（${flowSummaryLine(fv)}）。`
  }
  if (fv.tag === "分歧收敛") {
    return `存量反向，但两边都在收回（${flowSummaryLine(fv)}）。分歧在收敛。`
  }
  if (fv.tag === "分歧加剧") {
    return `存量反向，且仓位还在往各自方向加（${flowSummaryLine(fv)}）。`
  }
  if (fv.tag === "一侧变动") {
    return `只有一侧主动调仓（${flowSummaryLine(fv)}）。${cut}`
  }
  return ""
}

function consensusTitle(
  label: string,
  dir: string,
  beta: string,
  heavy: boolean,
  action: ActionKind,
  fv: FlowView | null,
): string {
  const tag = fv && fv.tag !== "变化很小" ? ` · ${fv.tag}` : ""
  const pnl = fv?.cutPnl && (action === "暂缓加码" || action === "减码准备") ? ` · ${fv.cutPnl}` : ""
  if (action === "暂缓加码") return `${label} 同向共振${heavy ? "" : "（弱共识）"}${tag}${pnl}`
  if (action === "减码准备") return `${label} 同向共振${heavy ? "" : "（弱共识）"}${tag}${pnl}`
  if (heavy) return `${label} 量化与主观共识${dir} — 可加 ${beta}${tag}`
  return `${label} 同向共振（弱共识）${tag}`
}

export function buildMomSignals(
  sectors: SignalSourceRow[],
  products: SignalSourceRow[],
  metric: ExposureMetric,
  quantShare: number,
  quantCount: number,
  subjCount: number,
  flows?: FlowMap,
  opts?: { includeNeutral?: boolean; limit?: number },
): MomSignal[] {
  const out: MomSignal[] = []
  const budget = metric === "risk" ? "风险预算" : "保证金"
  const expName = metric === "risk" ? "风险敞口" : "保证金敞口"

  for (const row of [...sectors, ...products]) {
    const { signal } = classifyExposure(row.quant, row.subjective, metric)
    const level: "sector" | "product" = row.sector ? "product" : "sector"
    const q = exposurePct(row.quant, metric)
    const s = exposurePct(row.subjective, metric)
    const aq = Math.abs(q)
    const as_ = Math.abs(s)
    const unit = level === "sector" ? "板块" : "品种"
    const label = level === "product" ? `${row.name}(${row.key})` : row.name
    const rowFlow = lookupFlow(flows, level, row.key)
    const fv = rowFlow ? classifyRowFlow(q, s, rowFlow) : null
    const strength = rowStrength(row.quant, row.subjective, metric, rowFlow)

    if (signal === "consensus_long" || signal === "consensus_short") {
      const dir = signal === "consensus_long" ? "做多" : "做空"
      const beta = signal === "consensus_long" ? "多头 beta" : "空头 beta"
      const heavy = aq >= HEAVY_MIN && as_ >= HEAVY_MIN
      const crowded = aq + as_ >= CROWD_SUM
      const action = consensusActionWithFlow(crowded, fv)
      const extra = flowSentence(fv, unit)
      if (crowded) {
        out.push({
          level, key: row.key, name: label, type: "crowded", action: "控拥挤",
          title: `${label} 共识${dir}但已拥挤${fv && fv.tag !== "变化很小" ? ` · ${fv.tag}` : ""}`,
          detail: `量化 ${exposureDirLabel(q)}、主观 ${exposureDirLabel(s)}，两侧合计${expName} ${(aq + as_).toFixed(1)}%。方向一致，但组合已偏拥挤，加码前先设总量上限。${extra}`,
          strength,
          flow: fv ?? undefined,
          quantPct: q,
          subjPct: s,
        })
      } else if (action === "暂缓加码") {
        out.push({
          level, key: row.key, name: label, type: signal, action,
          title: consensusTitle(label, dir, beta, heavy, action, fv),
          detail: `量化 ${exposureDirLabel(q)}、主观 ${exposureDirLabel(s)}。${extra || "存量同向但边际反向，暂缓加码。"}`,
          strength,
          flow: fv ?? undefined,
          quantPct: q,
          subjPct: s,
        })
      } else if (action === "减码准备") {
        out.push({
          level, key: row.key, name: label, type: signal, action,
          title: consensusTitle(label, dir, beta, heavy, action, fv),
          detail: `量化 ${exposureDirLabel(q)}、主观 ${exposureDirLabel(s)}。${extra || "两侧都在减该方向，先准备减码。"}`,
          strength,
          flow: fv ?? undefined,
          quantPct: q,
          subjPct: s,
        })
      } else if (heavy) {
        out.push({
          level, key: row.key, name: label, type: signal, action: "加码",
          title: consensusTitle(label, dir, beta, true, "加码", fv),
          detail: `量化 ${exposureDirLabel(q)}、主观 ${exposureDirLabel(s)}（占各侧${budget}）。两边同时重仓，方向共识强。可作为 MOM 加码该${unit}${beta} 的依据：给已有同向账户加钱，或新引进该方向投顾。${extra}`,
          strength,
          flow: fv ?? undefined,
          quantPct: q,
          subjPct: s,
        })
      } else {
        out.push({
          level, key: row.key, name: label, type: signal, action: "加码",
          title: consensusTitle(label, dir, beta, false, "加码", fv),
          detail: `量化 ${exposureDirLabel(q)}、主观 ${exposureDirLabel(s)}。方向一致但仓位未到重仓。${extra || `可小幅增加该${unit}暴露，或观察能否走强后再加。`}`,
          strength,
          flow: fv ?? undefined,
          quantPct: q,
          subjPct: s,
        })
      }
    } else if (signal === "divergence") {
      const extra = flowSentence(fv, unit)
      const tag = fv && (fv.tag === "分歧收敛" || fv.tag === "分歧加剧") ? ` · ${fv.tag}` : ""
      out.push({
        level, key: row.key, name: label, type: "divergence", action: "观望",
        title: `${label} 量化与主观方向相反${tag}`,
        detail: `量化 ${exposureDirLabel(q)}、主观 ${exposureDirLabel(s)}。风格分歧，暂不加该${unit} beta。${extra || "可等一侧被市场验证，或保持中性、用另一风格对冲。新投顾不要再往同一方向堆。"}`,
        strength,
        flow: fv ?? undefined,
        quantPct: q,
        subjPct: s,
      })
    } else if (signal === "quant_only") {
      out.push({
        level, key: row.key, name: label, type: "quant_only", action: "补风格",
        title: `${label} 仅量化重仓，主观几乎空白`,
        detail: `量化 ${exposureDirLabel(q)}，主观 ${exposureDirLabel(s)}。若希望该观点被另一风格确认，可考虑增加主观投顾覆盖该${unit}；若认定量化信号足够，则优先给量化账户加钱而非新开主观仓。`,
        strength,
        flow: fv ?? undefined,
        quantPct: q,
        subjPct: s,
      })
    } else if (signal === "subj_only") {
      out.push({
        level, key: row.key, name: label, type: "subj_only", action: "补风格",
        title: `${label} 仅主观重仓，量化几乎空白`,
        detail: `主观 ${exposureDirLabel(s)}，量化 ${exposureDirLabel(q)}。可考虑引进量化投顾覆盖该${unit}做分散确认；若只想放大已有主观观点，则给主观账户加钱。`,
        strength,
        flow: fv ?? undefined,
        quantPct: q,
        subjPct: s,
      })
    } else if (opts?.includeNeutral && level === "sector") {
      const extra = flowSentence(fv, unit)
      out.push({
        level, key: row.key, name: label, type: "neutral", action: "中性",
        title: `${label} 未达加码/观望阈值`,
        detail: `量化 ${exposureDirLabel(q)}、主观 ${exposureDirLabel(s)}。两侧仓位都偏轻或一侧不够大，记为中性。${extra}`,
        strength,
        flow: fv ?? undefined,
        quantPct: q,
        subjPct: s,
      })
    }
  }

  const n = quantCount + subjCount
  if (n > 0) {
    const countShare = (quantCount / n) * 100
    if (quantShare + 8 < countShare) {
      out.push({
        level: "allocation", key: "aum", name: "资金配置", type: "allocation", action: "扩容",
        title: "量化侧保证金占比偏低",
        detail: `量化 ${quantCount} 户、保证金占比 ${quantShare.toFixed(1)}%；主观 ${subjCount} 户。账户数占比高于资金占比，量化容量偏紧。新资金可优先考虑量化账户扩容。`,
        strength: Math.min(100, round1(countShare - quantShare + 20)),
      })
    } else if (quantShare > countShare + 15) {
      out.push({
        level: "allocation", key: "aum", name: "资金配置", type: "allocation", action: "扩容",
        title: "量化侧资金已偏集中",
        detail: `量化保证金占比 ${quantShare.toFixed(1)}%，高于账户数占比。继续加钱前先看量化内部是否已在共识板块拥挤；新顾问更宜补主观空白板块。`,
        strength: Math.min(100, round1(quantShare - countShare)),
      })
    }
  }

  out.sort((a, b) => b.strength - a.strength)
  if (!opts) return out.slice(0, 18)
  const limit = opts.limit ?? 18
  if (!limit) return out
  const keep = out.filter((s) => s.level !== "product")
  const productRows = out.filter((s) => s.level === "product")
  return [...keep, ...productRows.slice(0, Math.max(0, limit - keep.length))]
    .sort((a, b) => b.strength - a.strength)
}

export type ActionCounts = Record<ActionKind, number>

export interface TsSectorPoint {
  date: string
  sector: string
  quantNetPct: number
  subjNetPct: number
  quantEquityPct?: number
  subjEquityPct?: number
}

export interface TsProductPoint {
  date: string
  product: string
  quantNetPct: number
  subjNetPct: number
  quantEquityPct?: number
  subjEquityPct?: number
}

export interface HistSignalItem {
  level: "sector" | "product"
  key: string
  name: string
  action: ActionKind
  type: MomSignal["type"]
}

export interface SignalHistoryDay {
  date: string
  counts: ActionCounts
  items: HistSignalItem[]
}

export type SignalVsPrev = "new" | "same" | "changed"

function pctToSleeve(risk: number, equity: number): SleevePct {
  return { riskPctGroup: risk, equityPctGroup: equity, riskPctBook: 0, equityPctBook: 0 }
}

/** Daily 加码/观望/… from group risk % (same thresholds as the history heatmap). */
export function pctRowDecision(
  quantNetPct: number,
  subjNetPct: number,
  flow?: RowFlow | null,
): RowDecision {
  return rowDecision(pctToSleeve(quantNetPct, 0), pctToSleeve(subjNetPct, 0), "risk", flow)
}

/** 补风格 belongs on the empty sleeve: 仅主观重仓 → 量化图；仅量化重仓 → 主观图. */
export function buFenggeTargetSleeve(kind: DecisionKind): "量化" | "主观" | null {
  if (kind === "subj_only") return "量化"
  if (kind === "quant_only") return "主观"
  return null
}

export function emptyActionCounts(): ActionCounts {
  return { 加码: 0, 暂缓加码: 0, 减码准备: 0, 观望: 0, 补风格: 0, 控拥挤: 0, 扩容: 0 }
}

export function signalRowKey(level: string, key: string): string {
  return `${level}:${key}`
}

function posAt(
  long: number[][],
  short: number[][],
  longLots: number[][],
  shortLots: number[][],
  di: number,
  pi: number,
): HoldingPos {
  return {
    longMv: long[di]?.[pi] ?? 0,
    shortMv: short[di]?.[pi] ?? 0,
    longLots: longLots[di]?.[pi] ?? 0,
    shortLots: shortLots[di]?.[pi] ?? 0,
  }
}

function sumDecomp(
  src: FlowGridSource,
  sleeve: "quant" | "subj",
  idxs: number[],
  di: number,
  prevDi: number,
  look5: number,
): SleeveFlow {
  const long = sleeve === "quant" ? src.quantLong : src.subjLong
  const short = sleeve === "quant" ? src.quantShort : src.subjShort
  const longLots = sleeve === "quant" ? src.quantLongLots : src.subjLongLots
  const shortLots = sleeve === "quant" ? src.quantShortLots : src.subjShortLots
  let prevNet = 0
  let todayNet = 0
  let trade1d = 0
  let price1d = 0
  let trade5d = 0
  for (const pi of idxs) {
    const today = posAt(long, short, longLots, shortLots, di, pi)
    const prev = posAt(long, short, longLots, shortLots, prevDi, pi)
    const d = decomposeNet(prev, today)
    prevNet += d.prevNet
    todayNet += d.todayNet
    trade1d += d.trade
    price1d += d.price
    const from5 = posAt(long, short, longLots, shortLots, look5, pi)
    const dLots5 = (today.longLots - today.shortLots) - (from5.longLots - from5.shortLots)
    trade5d += dLots5 * (lotsPrice(today) || lotsPrice(from5))
  }
  return {
    ...emptySleeveFlow(),
    trade1d,
    trade5d,
    price1d,
    prevNet,
    todayNet,
  }
}

export function buildFlowMapFromGrid(src: FlowGridSource, date: string): FlowMap {
  const di = src.dates.indexOf(date)
  const out: FlowMap = {}
  if (di < 1) return out
  const prevDi = di - 1
  const look5 = Math.max(0, di - 5)
  const bySector = new Map<string, number[]>()
  src.products.forEach((p, pi) => {
    const arr = bySector.get(p.sector)
    if (arr) arr.push(pi)
    else bySector.set(p.sector, [pi])
  })
  for (const [sector, idxs] of bySector) {
    out[signalRowKey("sector", sector)] = {
      quant: sumDecomp(src, "quant", idxs, di, prevDi, look5),
      subjective: sumDecomp(src, "subj", idxs, di, prevDi, look5),
    }
  }
  src.products.forEach((p, pi) => {
    out[signalRowKey("product", p.code)] = {
      quant: sumDecomp(src, "quant", [pi], di, prevDi, look5),
      subjective: sumDecomp(src, "subj", [pi], di, prevDi, look5),
    }
  })
  return out
}

export interface AccountTradeRow {
  account: string
  sleeve: "quant" | "subjective"
  level: "sector" | "product"
  key: string
  trade: number
  prevNet: number
  todayNet: number
}

function accountDir(trade: number, prevNet: number, todayNet: number): "add" | "cut" | "flat" {
  if (!flowIsLive(trade, prevNet, todayNet, ACCT_FLOW_MIN)) return "flat"
  if (trade > 0) return "add"
  if (trade < 0) return "cut"
  return "flat"
}

export function mergeAccountBreadth(
  flows: FlowMap,
  rows: AccountTradeRow[],
  quantAccounts: string[],
): FlowMap {
  const grouped = new Map<string, AccountTradeRow[]>()
  for (const r of rows) {
    const k = signalRowKey(r.level, r.key)
    const arr = grouped.get(k)
    if (arr) arr.push(r)
    else grouped.set(k, [r])
  }
  for (const [k, list] of grouped) {
    const flow = flows[k]
    if (!flow) continue
    const apply = (sleeve: "quant" | "subjective", dest: SleeveFlow) => {
      const mine = list.filter((r) => r.sleeve === sleeve)
      let add = 0, cut = 0, flat = 0
      const cells: AccountFlowCell[] = []
      const seen = new Set<string>()
      for (const r of mine) {
        const dir = accountDir(r.trade, r.prevNet, r.todayNet)
        if (dir === "add") add += 1
        else if (dir === "cut") cut += 1
        else flat += 1
        if (sleeve === "quant") cells.push({ account: r.account, trade: r.trade })
        seen.add(r.account)
      }
      if (sleeve === "quant") {
        for (const acc of quantAccounts) {
          if (seen.has(acc)) continue
          flat += 1
          cells.push({ account: acc, trade: 0 })
        }
        cells.sort((a, b) => a.account.localeCompare(b.account, "en"))
        dest.cells = cells
      }
      dest.addAccounts = add
      dest.cutAccounts = cut
      dest.flatAccounts = flat
      dest.nAccounts = add + cut + flat
    }
    apply("quant", flow.quant)
    apply("subjective", flow.subjective)
  }
  return flows
}

/** Rebuild daily MOM signals from sector/product time series (group % only, no 扩容). */
export function buildSignalHistory(
  sectorTs: TsSectorPoint[],
  productTs: TsProductPoint[],
  productName: (code: string) => string,
  flowSrc?: FlowGridSource,
): SignalHistoryDay[] {
  const dates = [...new Set([
    ...sectorTs.map((r) => r.date),
    ...productTs.map((r) => r.date),
  ])].sort()
  const secByDate = new Map<string, TsSectorPoint[]>()
  for (const r of sectorTs) {
    const arr = secByDate.get(r.date)
    if (arr) arr.push(r)
    else secByDate.set(r.date, [r])
  }
  const prodByDate = new Map<string, TsProductPoint[]>()
  for (const r of productTs) {
    const arr = prodByDate.get(r.date)
    if (arr) arr.push(r)
    else prodByDate.set(r.date, [r])
  }

  return dates.map((date) => {
    const sectors: SignalSourceRow[] = (secByDate.get(date) ?? []).map((r) => ({
      key: r.sector,
      name: r.sector,
      quant: pctToSleeve(r.quantNetPct, r.quantEquityPct ?? 0),
      subjective: pctToSleeve(r.subjNetPct, r.subjEquityPct ?? 0),
    }))
    const products: SignalSourceRow[] = (prodByDate.get(date) ?? [])
      .map((r) => ({
        key: r.product,
        name: productName(r.product),
        sector: r.product,
        quant: pctToSleeve(r.quantNetPct, r.quantEquityPct ?? 0),
        subjective: pctToSleeve(r.subjNetPct, r.subjEquityPct ?? 0),
      }))
      .sort((a, b) =>
        Math.abs(b.quant.riskPctGroup) + Math.abs(b.subjective.riskPctGroup)
        - (Math.abs(a.quant.riskPctGroup) + Math.abs(a.subjective.riskPctGroup)),
      )
      .slice(0, 40)
    const flows = flowSrc ? buildFlowMapFromGrid(flowSrc, date) : undefined
    const signals = buildMomSignals(sectors, products, "risk", 0, 0, 0, flows)
    const counts = emptyActionCounts()
    const items: HistSignalItem[] = []
    for (const s of signals) {
      if (s.level === "allocation" || s.action === "中性") continue
      counts[s.action] += 1
      items.push({
        level: s.level,
        key: s.key,
        name: s.name,
        action: s.action,
        type: s.type,
      })
    }
    return { date, counts, items }
  })
}

export function tagSignalsVsPrev(
  current: MomSignal[],
  prevItems: HistSignalItem[] | undefined,
): {
  tagged: (MomSignal & { vsPrev: SignalVsPrev; prevAction?: ActionKind })[]
  gone: HistSignalItem[]
} {
  const prevMap = new Map((prevItems ?? []).map((i) => [signalRowKey(i.level, i.key), i]))
  const tagged = current.map((s) => {
    if (s.level === "allocation") return { ...s, vsPrev: "same" as const }
    const prev = prevMap.get(signalRowKey(s.level, s.key))
    if (!prev) {
      // 中性 rows are always listed; missing yesterday only means they also had no signal.
      if (s.action === "中性") return { ...s, vsPrev: "same" as const }
      return { ...s, vsPrev: "new" as const }
    }
    if (prev.action === s.action) return { ...s, vsPrev: "same" as const, prevAction: prev.action }
    return { ...s, vsPrev: "changed" as const, prevAction: prev.action }
  })
  const currKeys = new Set(current.map((s) => signalRowKey(s.level, s.key)))
  const gone = (prevItems ?? []).filter((i) => !currKeys.has(signalRowKey(i.level, i.key)))
  return { tagged, gone }
}
