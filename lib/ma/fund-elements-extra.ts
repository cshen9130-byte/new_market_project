export type PerfFeeMode = "none" | "fixed" | "annual_gradient" | "excess_gradient" | "benchmark"

export interface PerfFeeGradient {
  fromPct: string
  toPct: string
  ratePct: string
}

export interface FeePayFormulaConfig {
  mode: PerfFeeMode
  gradients?: PerfFeeGradient[]
}

const PERF_FEE_LABELS: Record<PerfFeeMode, string> = {
  none: "无",
  fixed: "按固定比例计提",
  annual_gradient: "按年化收益梯度计提",
  excess_gradient: "按超额年化收益梯度计提",
  benchmark: "按计提基准计提",
}

const PERF_FEE_MODES = new Set<string>(Object.keys(PERF_FEE_LABELS))

export function normalizePerfFeeMode(value: unknown): PerfFeeMode | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  return PERF_FEE_MODES.has(s) ? (s as PerfFeeMode) : null
}

export function normalizePerfFeeGradients(value: unknown): PerfFeeGradient[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows = value
    .map((row) => {
      if (!row || typeof row !== "object") return null
      const r = row as Record<string, unknown>
      return {
        fromPct: String(r.fromPct ?? r.from_pct ?? "").trim(),
        toPct: String(r.toPct ?? r.to_pct ?? "").trim(),
        ratePct: String(r.ratePct ?? r.rate_pct ?? "").trim(),
      }
    })
    .filter((row): row is PerfFeeGradient => row != null)
  return rows.length > 0 ? rows : undefined
}

export function parseFeePayFormulaConfig(value: unknown): FeePayFormulaConfig | null {
  if (value == null) return null
  let raw: unknown = value
  if (typeof value === "string") {
    const s = value.trim()
    if (!s) return null
    try {
      raw = JSON.parse(s)
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const mode = normalizePerfFeeMode(obj.mode)
  if (!mode) return null
  return {
    mode,
    gradients: normalizePerfFeeGradients(obj.gradients),
  }
}

export function formatFeePayFormula(config: FeePayFormulaConfig | null | undefined): string | null {
  if (!config?.mode) return null
  if (config.mode === "none") return "无"
  if (config.mode === "annual_gradient" && config.gradients?.length) {
    const tiers = config.gradients.map((g) => {
      if (g.toPct) return `${g.fromPct}%≤年化收益<${g.toPct}% * 计提比例${g.ratePct}%`
      return `${g.fromPct}%≤年化收益 * 计提比例${g.ratePct}%`
    })
    return `按年化收益梯度计提：${tiers.join("；")}`
  }
  return PERF_FEE_LABELS[config.mode] ?? config.mode
}

export function buildFeePayFormulaConfig(
  mode: unknown,
  gradients: unknown,
): FeePayFormulaConfig | null {
  const normalizedMode = normalizePerfFeeMode(mode)
  if (!normalizedMode) return null
  return {
    mode: normalizedMode,
    gradients:
      normalizedMode === "annual_gradient" || normalizedMode === "excess_gradient"
        ? normalizePerfFeeGradients(gradients)
        : undefined,
  }
}
