export type ExposureMetric = "risk" | "equity"

export type SignalKind =
  | "consensus_long"
  | "consensus_short"
  | "divergence"
  | "quant_only"
  | "subj_only"
  | "neutral"

export type ActionKind = "加码" | "观望" | "补风格" | "控拥挤" | "扩容"

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

export interface MomSignal {
  level: "sector" | "product" | "allocation"
  key: string
  name: string
  type: SignalKind | "crowded" | "allocation"
  action: ActionKind
  title: string
  detail: string
  strength: number
}

const CONSENSUS_MIN = 3
const HEAVY_MIN = 8
const LIGHT_MAX = 1.5
const CROWD_SUM = 25

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

/** Action + kind for one sector/product row. Includes 中性 (unlike buildMomSignals). */
export function rowDecision(
  quant: SleevePct,
  subjective: SleevePct,
  metric: ExposureMetric,
): RowDecision {
  const { signal } = classifyExposure(quant, subjective, metric)
  const aq = Math.abs(exposurePct(quant, metric))
  const as_ = Math.abs(exposurePct(subjective, metric))
  if (signal === "consensus_long" || signal === "consensus_short") {
    if (aq + as_ >= CROWD_SUM) return { kind: "crowded", action: "控拥挤" }
    return { kind: signal, action: "加码" }
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
): number {
  const { signal } = classifyExposure(quant, subjective, metric)
  const aq = Math.abs(exposurePct(quant, metric))
  const as_ = Math.abs(exposurePct(subjective, metric))
  const book = Math.abs(bookExposurePct(quant, metric)) + Math.abs(bookExposurePct(subjective, metric))
  if (signal === "consensus_long" || signal === "consensus_short") {
    if (aq + as_ >= CROWD_SUM) return Math.min(100, round1(aq + as_ + book))
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

function dirLabel(pct: number): string {
  if (pct > 0.15) return `多 ${pct.toFixed(1)}%`
  if (pct < -0.15) return `空 ${Math.abs(pct).toFixed(1)}%`
  return `平 ${pct.toFixed(1)}%`
}

export function buildMomSignals(
  sectors: SignalSourceRow[],
  products: SignalSourceRow[],
  metric: ExposureMetric,
  quantShare: number,
  quantCount: number,
  subjCount: number,
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
    const book = Math.abs(bookExposurePct(row.quant, metric)) + Math.abs(bookExposurePct(row.subjective, metric))
    const unit = level === "sector" ? "板块" : "品种"
    const label = level === "product" ? `${row.name}(${row.key})` : row.name
    const strength = rowStrength(row.quant, row.subjective, metric)

    if (signal === "consensus_long" || signal === "consensus_short") {
      const dir = signal === "consensus_long" ? "做多" : "做空"
      const beta = signal === "consensus_long" ? "多头 beta" : "空头 beta"
      const heavy = aq >= HEAVY_MIN && as_ >= HEAVY_MIN
      const crowded = aq + as_ >= CROWD_SUM
      if (crowded) {
        out.push({
          level, key: row.key, name: label, type: "crowded", action: "控拥挤",
          title: `${label} 共识${dir}但已拥挤`,
          detail: `量化 ${dirLabel(q)}、主观 ${dirLabel(s)}，两侧合计${expName} ${(aq + as_).toFixed(1)}%。方向一致，但组合已偏拥挤，加码前先设总量上限。`,
          strength,
        })
      } else if (heavy) {
        out.push({
          level, key: row.key, name: label, type: signal, action: "加码",
          title: `${label} 量化与主观共识${dir} — 可加 ${beta}`,
          detail: `量化 ${dirLabel(q)}、主观 ${dirLabel(s)}（占各侧${budget}）。两边同时重仓，方向共识强。可作为 MOM 加码该${unit}${beta} 的依据：给已有同向账户加钱，或新引进该方向投顾。`,
          strength,
        })
      } else {
        out.push({
          level, key: row.key, name: label, type: signal, action: "加码",
          title: `${label} 同向共振（弱共识）`,
          detail: `量化 ${dirLabel(q)}、主观 ${dirLabel(s)}。方向一致但仓位未到重仓。可小幅增加该${unit}暴露，或观察能否走强后再加。`,
          strength,
        })
      }
    } else if (signal === "divergence") {
      out.push({
        level, key: row.key, name: label, type: "divergence", action: "观望",
        title: `${label} 量化与主观方向相反`,
        detail: `量化 ${dirLabel(q)}、主观 ${dirLabel(s)}。风格分歧，暂不加该${unit} beta。可等一侧被市场验证，或保持中性、用另一风格对冲。新投顾不要再往同一方向堆。`,
          strength,
      })
    } else if (signal === "quant_only") {
      out.push({
        level, key: row.key, name: label, type: "quant_only", action: "补风格",
        title: `${label} 仅量化重仓，主观几乎空白`,
        detail: `量化 ${dirLabel(q)}，主观 ${dirLabel(s)}。若希望该观点被另一风格确认，可考虑增加主观投顾覆盖该${unit}；若认定量化信号足够，则优先给量化账户加钱而非新开主观仓。`,
          strength,
      })
    } else if (signal === "subj_only") {
      out.push({
        level, key: row.key, name: label, type: "subj_only", action: "补风格",
        title: `${label} 仅主观重仓，量化几乎空白`,
        detail: `主观 ${dirLabel(s)}，量化 ${dirLabel(q)}。可考虑引进量化投顾覆盖该${unit}做分散确认；若只想放大已有主观观点，则给主观账户加钱。`,
          strength,
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
  return out.slice(0, 18)
}
