/** Cross-account conclusions for 量化策略「横向对比」。Uses already-fetched per-account payloads. */

export type CompareTone = "good" | "bad" | "neutral"

export interface CompareFinding {
  title: string
  detail: string
  tone: CompareTone
}

export interface CompareAccount {
  account?: string | null
  accountId?: string
  portrait?: { strategyLabel: string }
  kpis?: {
    tradingDays: number
    totalPnl: number
    dayWinRate: number
    tradeWinRate: number
    profitFactor: number | null
    sharpe: number | null
    maxDdPct: number
    avgHoldWin: number | null
    avgHoldLoss: number | null
    medianHold: number | null
    hedgeRatioAvg: number
    lockShareAvg?: number
    nCloses: number
    corrNhci: number | null
    upCapture?: number | null
    downCapture?: number | null
  }
  equity?: { date: string; pnl: number; cumPnl: number }[]
  regime?: { key: string; label: string; pnl: number; days?: number; winRate?: number }[]
  regimeFactors?: {
    families: Array<{
      key: string
      title: string
      buckets: Array<{ key: string; label: string; pnl: number; avgPnl: number; days: number }>
    }>
  }
  sectors?: { sector: string; pnl: number }[]
  session?: { day: { pnl: number; lots: number }; night: { pnl: number; lots: number } }
  afterMove?: {
    afterWin: { dRisk: number | null }
    afterLoss: { dRisk: number | null }
  }
  inference?: { headline?: string; supported?: { title: string }[] }
}

export interface CorrPair {
  a: string
  b: string
  corr: number
  n: number
}

export interface SectorConsensus {
  sector: string
  pos: number
  neg: number
  pnl: number
}

export interface CompareInsights {
  headline: string
  findings: CompareFinding[]
  bookPnl: number
  winners: number
  losers: number
  avgCorr: number | null
  corrPairs: CorrPair[]
  corrMatrix: { labels: string[]; values: (number | null)[][] }
  sectorConsensus: SectorConsensus[]
  styleGroups: { label: string; accounts: string[] }[]
}

function accId(d: CompareAccount): string {
  const raw = d.accountId || d.account || ""
  const digits = String(raw).replace(/\D/g, "")
  return digits ? `rx${digits}` : "—"
}

function baseLabel(s: string): string {
  return s.replace(/\s*·\s*.+$/, "").trim() || s
}

function mean(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 15 || ys.length !== n) return null
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx
    const y = ys[i] - my
    num += x * y
    dx += x * x
    dy += y * y
  }
  const den = Math.sqrt(dx * dy)
  if (den < 1e-12) return null
  return num / den
}

function pnlSeries(d: CompareAccount): Map<string, number> {
  const m = new Map<string, number>()
  let started = false
  for (const e of d.equity ?? []) {
    if (!started && e.pnl === 0 && e.cumPnl === 0) continue
    started = true
    m.set(e.date, e.pnl)
  }
  return m
}

function nightShare(d: CompareAccount): number | null {
  const day = d.session?.day.lots ?? 0
  const night = d.session?.night.lots ?? 0
  if (day + night <= 0) return null
  return (night / (day + night)) * 100
}

function regimePnl(d: CompareAccount, key: string): number {
  return d.regime?.find((x) => x.key === key)?.pnl ?? 0
}

function factorAvg(d: CompareAccount, family: string, key: string): number {
  return d.regimeFactors?.families.find((f) => f.key === family)?.buckets.find((b) => b.key === key)?.avgPnl ?? 0
}

function factorDays(d: CompareAccount, family: string, key: string): number {
  return d.regimeFactors?.families.find((f) => f.key === family)?.buckets.find((b) => b.key === key)?.days ?? 0
}

function fmtWan(n: number): string {
  const abs = Math.abs(n)
  const sign = n > 0 ? "+" : n < 0 ? "-" : ""
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}万`
  return `${sign}${Math.round(abs).toLocaleString("zh-CN")}`
}

function fmtPct(n: number, d = 0): string {
  return `${n.toFixed(d)}%`
}

function joinAcc(ids: string[]): string {
  return ids.join("、")
}

export function buildCompareInsights(rows: CompareAccount[]): CompareInsights | null {
  if (rows.length < 2) return null

  const ids = rows.map(accId)
  const series = rows.map(pnlSeries)
  const labels = ids
  const values: (number | null)[][] = labels.map(() => labels.map(() => null))
  const pairs: CorrPair[] = []

  for (let i = 0; i < rows.length; i++) {
    values[i][i] = 1
    for (let j = i + 1; j < rows.length; j++) {
      const dates = [...series[i].keys()].filter((d) => series[j].has(d))
      const xs = dates.map((d) => series[i].get(d) as number)
      const ys = dates.map((d) => series[j].get(d) as number)
      const c = pearson(xs, ys)
      values[i][j] = c
      values[j][i] = c
      if (c != null) pairs.push({ a: ids[i], b: ids[j], corr: c, n: dates.length })
    }
  }
  pairs.sort((a, b) => b.corr - a.corr)
  const stablePairs = pairs.filter((p) => p.n >= 40)
  const avgCorr = (stablePairs.length ? stablePairs : pairs).length
    ? mean((stablePairs.length ? stablePairs : pairs).map((p) => p.corr))
    : null

  const bookPnl = rows.reduce((s, r) => s + (r.kpis?.totalPnl ?? 0), 0)
  const winners = rows.filter((r) => (r.kpis?.totalPnl ?? 0) > 0).length
  const losers = rows.filter((r) => (r.kpis?.totalPnl ?? 0) < 0).length

  const styleMap = new Map<string, string[]>()
  for (const r of rows) {
    const lab = baseLabel(r.portrait?.strategyLabel ?? "未分类")
    const list = styleMap.get(lab) ?? []
    list.push(accId(r))
    styleMap.set(lab, list)
  }
  const styleGroups = [...styleMap.entries()]
    .map(([label, accounts]) => ({ label, accounts }))
    .sort((a, b) => b.accounts.length - a.accounts.length)

  const sectorMap = new Map<string, SectorConsensus>()
  for (const r of rows) {
    for (const s of r.sectors ?? []) {
      const cur = sectorMap.get(s.sector) ?? { sector: s.sector, pos: 0, neg: 0, pnl: 0 }
      if (s.pnl > 0) cur.pos += 1
      else if (s.pnl < 0) cur.neg += 1
      cur.pnl += s.pnl
      sectorMap.set(s.sector, cur)
    }
  }
  const sectorConsensus = [...sectorMap.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))

  const findings: CompareFinding[] = []

  const dominant = styleGroups[0]
  if (dominant && dominant.accounts.length >= Math.ceil(rows.length * 0.7)) {
    const extra = avgCorr != null && avgCorr >= 0.35
      ? `日盈亏平均相关 ${avgCorr.toFixed(2)}，同涨同跌，横向分散有限。`
      : avgCorr != null
        ? `日盈亏平均相关 ${avgCorr.toFixed(2)}。`
        : ""
    findings.push({
      title: "风格高度同质",
      detail: `${dominant.accounts.length}/${rows.length} 个账户被判为「${dominant.label}」。${extra}这不是七套互相独立的策略，更像同一类 CTA 的不同参数 / 不同起步日。`,
      tone: "bad",
    })
  } else if (styleGroups.length >= 3) {
    findings.push({
      title: "风格有分化",
      detail: styleGroups.map((g) => `${g.label}（${joinAcc(g.accounts)}）`).join("；") + "。",
      tone: "good",
    })
  }

  const betaLong = rows.filter((r) => (r.kpis?.corrNhci ?? 0) >= 0.22)
  const upSum = rows.reduce((s, r) => s + regimePnl(r, "up"), 0)
  const downSum = rows.reduce((s, r) => s + regimePnl(r, "down"), 0)
  const trendSum = rows.reduce((s, r) => s + regimePnl(r, "trend"), 0)
  const rangeSum = rows.reduce((s, r) => s + regimePnl(r, "range"), 0)
  if (betaLong.length >= 2 && upSum > 0 && downSum < 0) {
    findings.push({
      title: "共同吃商品多头",
      detail: `${joinAcc(betaLong.map(accId))} 与南华日收益相关 ≥ 0.22。组合在商品上涨日合计 ${fmtWan(upSum)}，下跌日合计 ${fmtWan(downSum)}；三周期同向 ${fmtWan(trendSum)}，趋势分化 ${fmtWan(rangeSum)}。对冲度再高，方向上仍是多商品 beta。`,
      tone: "neutral",
    })
  }

  const carryBack = rows.reduce((s, r) => s + factorAvg(r, "carry", "deepBack") + factorAvg(r, "carry", "mildBack"), 0)
  const carryCont = rows.reduce((s, r) => s + factorAvg(r, "carry", "deepCont") + factorAvg(r, "carry", "mildCont"), 0)
  const alignedUp = rows.reduce((s, r) => s + factorAvg(r, "trend", "alignedUp"), 0)
  const alignedDn = rows.reduce((s, r) => s + factorAvg(r, "trend", "alignedDown"), 0)
  const hasFactor = rows.some((r) => (r.regimeFactors?.families.length ?? 0) > 0)
  if (hasFactor && factorDays(rows[0], "carry", "deepBack") + factorDays(rows[0], "carry", "mildBack") >= 8) {
    if (carryBack > 0 && carryCont <= 0 && alignedUp > 0 && alignedDn <= 0) {
      findings.push({
        title: "赚的是贴水里的多头，不是双边趋势",
        detail: `组合在贴水日均 ${fmtWan(carryBack)}、升水 ${fmtWan(carryCont)}；三周期同向多 ${fmtWan(alignedUp)}、同向空 ${fmtWan(alignedDn)}。更像 carry + 商品多头，而不是两边都能做的趋势跟踪。`,
        tone: "neutral",
      })
    }
  }

  const hedgeHi = rows.filter((r) => (r.kpis?.hedgeRatioAvg ?? 0) >= 50)
  const lockAvg = mean(rows.map((r) => r.kpis?.lockShareAvg ?? 0))
  if (hedgeHi.length >= 3 && lockAvg < 5 && upSum > Math.abs(downSum) * 0.6) {
    findings.push({
      title: "对冲是跨品种，不是锁仓",
      detail: `${hedgeHi.length} 个账户平均对冲度 ≥ 50%，但同一合约双开接近 0%。多空对锁发生在不同品种上，挡不住商品指数同向波动。`,
      tone: "neutral",
    })
  }

  const rankedPnl = [...rows].sort((a, b) => (b.kpis?.totalPnl ?? 0) - (a.kpis?.totalPnl ?? 0))
  const topPnl = rankedPnl[0]
  const absBook = rows.reduce((s, r) => s + Math.abs(r.kpis?.totalPnl ?? 0), 0)
  const topShare = absBook > 0 ? Math.abs(topPnl.kpis?.totalPnl ?? 0) / absBook : 0
  if (topPnl.kpis && topShare >= 0.28) {
    findings.push({
      title: "收益集中",
      detail: `组合净盈亏 ${fmtWan(bookPnl)}。${accId(topPnl)} 独占 ${fmtWan(topPnl.kpis.totalPnl)}（占各账户盈亏绝对值的 ${fmtPct(topShare * 100, 0)}）。组合表现很大程度上就是这一套。`,
      tone: topShare >= 0.4 ? "bad" : "neutral",
    })
  }

  const enough = rows.filter((r) => (r.kpis?.tradingDays ?? 0) >= 40 && r.kpis?.sharpe != null)
  const bySharpe = [...enough].sort((a, b) => (b.kpis?.sharpe ?? -99) - (a.kpis?.sharpe ?? -99))
  if (bySharpe[0]?.kpis?.sharpe != null) {
    const best = bySharpe[0]
    const k = best.kpis!
    const alsoDeepDd = topPnl !== best && (topPnl.kpis?.maxDdPct ?? 0) < (k.maxDdPct ?? 0) - 2
    findings.push({
      title: "风险调整最优",
      detail: `${accId(best)} 夏普 ${k.sharpe?.toFixed(2)}、日胜率 ${fmtPct(k.dayWinRate, 0)}、最大回撤 ${fmtPct(k.maxDdPct)}、对冲度 ${fmtPct(k.hedgeRatioAvg, 0)}。${
        alsoDeepDd
          ? `${accId(topPnl)} 绝对收益更大，但账户净值从峰值回撤更深（${fmtPct(topPnl.kpis?.maxDdPct ?? 0)}）。这是整本账户的风险预算开得更大（赚得多、回撤也深），不是「波动高就加仓」。品种之间仍可以高波动少配（截面 1/σ），和账户总回撤是两件事。`
          : "在样本足够的账户里，这是赔率最好的一套。"
      }`,
      tone: "good",
    })
  }

  const drag = rows.filter((r) => (r.kpis?.totalPnl ?? 0) < 0 || (r.kpis?.sharpe ?? 0) < 0)
  if (drag.length) {
    const bits = drag.map((r) => {
      const hold = r.kpis?.medianHold
      const night = nightShare(r)
      const wr = r.kpis?.tradeWinRate
      const afterL = r.afterMove?.afterLoss.dRisk
      const extras: string[] = []
      if (hold != null && hold <= 2) extras.push(`持仓中位数 ${hold.toFixed(1)} 天，偏短线`)
      if (night != null && night < 15) extras.push(`夜盘手数仅 ${fmtPct(night, 0)}`)
      if (wr != null && wr < 20) extras.push(`平仓胜率 ${fmtPct(wr, 0)}`)
      if (afterL != null && afterL > 0.1) extras.push(`亏损次日风险度升 ${afterL.toFixed(2)} 个百分点，有加仓倾向`)
      if ((r.kpis?.avgHoldLoss ?? 0) > (r.kpis?.avgHoldWin ?? 0) * 1.2) extras.push("亏单拿得比盈单久")
      return `${accId(r)}（${fmtWan(r.kpis?.totalPnl ?? 0)}，夏普 ${r.kpis?.sharpe?.toFixed(2) ?? "—"}）${extras.length ? "：" + extras.join("，") : ""}`
    })
    findings.push({
      title: "当前拖累",
      detail: bits.join("。") + "。",
      tone: "bad",
    })
  }

  const sharedWin = sectorConsensus.find((s) => s.pos >= 3 && s.pnl > 0)
  const sharedLose = sectorConsensus.filter((s) => s.neg >= 3 && s.pnl < 0).slice(0, 2)
  if (sharedWin || sharedLose.length) {
    const parts: string[] = []
    if (sharedWin) parts.push(`${sharedWin.sector} 有 ${sharedWin.pos} 个账户赚钱，合计 ${fmtWan(sharedWin.pnl)}，是共同利润源`)
    if (sharedLose.length) {
      parts.push(sharedLose.map((s) => `${s.sector} 有 ${s.neg} 个账户亏损（合计 ${fmtWan(s.pnl)}）`).join("、") + "，是共同拖累")
    }
    findings.push({
      title: "板块也重叠",
      detail: parts.join("；") + "。账户之间没有在板块层面对冲掉彼此。",
      tone: "neutral",
    })
  }

  const nightHi = rows.filter((r) => (nightShare(r) ?? 0) >= 60).map(accId)
  const nightLo = rows.filter((r) => {
    const n = nightShare(r)
    return n != null && n < 15
  }).map(accId)
  if (nightHi.length && nightLo.length) {
    findings.push({
      title: "日夜盘才是真差异",
      detail: `${joinAcc(nightHi)} 夜盘手数过半；${joinAcc(nightLo)} 几乎只做日盘。持仓周期也分化：${
        rows
          .filter((r) => r.kpis?.medianHold != null)
          .sort((a, b) => (a.kpis?.medianHold ?? 0) - (b.kpis?.medianHold ?? 0))
          .map((r) => `${accId(r)} ${r.kpis!.medianHold!.toFixed(1)} 天`)
          .join("，")
      }。`,
      tone: "good",
    })
  }

  const infRows = rows.filter((r) => r.inference?.headline)
  if (infRows.length >= 2) {
    const unique = new Set(infRows.map((r) => r.inference!.headline))
    findings.push({
      title: unique.size >= 2 ? "成交规则痕迹并不相同" : "成交规则痕迹相近",
      detail: infRows.map((r) => `${accId(r)}：${r.inference!.headline}`).join("。") + "。",
      tone: unique.size >= 2 ? "good" : "neutral",
    })
  }

  const thin = rows.filter((r) => (r.kpis?.tradingDays ?? 0) < 50)
  if (thin.length) {
    findings.push({
      title: "短样本要打折",
      detail: `${joinAcc(thin.map((r) => `${accId(r)}（${r.kpis?.tradingDays ?? 0} 个交易日）`))} 起步晚，夏普 / 回撤还不稳定，不宜和满样本账户并列定论。`,
      tone: "neutral",
    })
  }

  if (pairs.length) {
    const ranked = (stablePairs.length ? stablePairs : pairs)
    const hi = ranked.filter((p) => p.corr >= 0.45).slice(0, 3)
    const lo = [...ranked].sort((a, b) => a.corr - b.corr).slice(0, 2)
    if (hi.length) {
      findings.push({
        title: "谁和谁走在一起",
        detail: `相关最高：${hi.map((p) => `${p.a}–${p.b} ${p.corr.toFixed(2)}`).join("，")}。最低：${lo.map((p) => `${p.a}–${p.b} ${p.corr.toFixed(2)}`).join("，")}。相关低的账户才提供真正的分散。`,
        tone: hi.length >= 2 ? "bad" : "neutral",
      })
    }
  }

  let headline: string
  if (dominant && dominant.accounts.length >= rows.length - 1 && avgCorr != null && avgCorr >= 0.3) {
    headline = `这 ${rows.length} 个量化账户基本是同一类「${dominant.label}」。组合净盈亏 ${fmtWan(bookPnl)}，但日盈亏平均相关 ${avgCorr.toFixed(2)}，上涨一起赚、下跌一起回吐，横向对比看到的差异主要是仓位、持仓天数和起步早晚，不是独立的 alpha。`
  } else if (avgCorr != null && avgCorr < 0.2) {
    headline = `账户日盈亏平均相关只有 ${avgCorr.toFixed(2)}，风格互补强于重叠。组合净盈亏 ${fmtWan(bookPnl)}，${winners} 个赚钱、${losers} 个亏损。`
  } else {
    headline = `组合净盈亏 ${fmtWan(bookPnl)}（${winners} 赚 / ${losers} 亏）。${
      dominant ? `主导画像是「${dominant.label}」` : "画像不完全相同"
    }${avgCorr != null ? `，日盈亏平均相关 ${avgCorr.toFixed(2)}` : ""}。下面按证据列出能站得住的结论。`
  }

  return {
    headline,
    findings,
    bookPnl,
    winners,
    losers,
    avgCorr,
    corrPairs: pairs,
    corrMatrix: { labels, values },
    sectorConsensus: sectorConsensus.slice(0, 8),
    styleGroups,
  }
}
