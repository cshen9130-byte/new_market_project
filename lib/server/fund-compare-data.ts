import { buildCompareMetricsRows } from "@/lib/fund-compare-metrics"
import {
  alignReturnCurves,
  clipBenchmarkReturns,
  resolveCompareWindow,
  type CurvePoint,
} from "@/lib/ma/fund-compare-window"
import { privateFundBenchmarkLabel } from "@/lib/ma/private-fund-benchmark-options"
import { fundDataErr, fundDataOk, loadCompareFundRecord, lookupFundQueryHits, type FundDataEnvelope } from "@/lib/server/fund-data-api"
import { isPrivateFundBenchmarkKey } from "@/lib/server/private-fund-benchmarks"

const NOTE =
  "和投资分析「基金对比」点分析后的指标表同一套计算。默认近一年、对齐起点、基准沪深300（IF）。period_return_pct、ann_return_pct、ann_vol_pct、downside_risk_pct、max_drawdown_pct 以及 intervals 里的收益都是百分点，1.28 表示 1.28%。夏普、卡玛、索提诺是比率。页面上保存的对比组在浏览器本地，这里按产品名或备案号重算，不读取那些组。"

function subjectsOf(record: Record<string, string | undefined>): string[] {
  const raw = record.subjects || record.q || record.reg_code || ""
  return raw.split(/[,，;；\n]+/).map((part) => part.trim()).filter(Boolean).slice(0, 8)
}

function round(value: number | null, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function compareFunds(
  record: Record<string, string | undefined>,
): Promise<FundDataEnvelope<unknown>> {
  const subjects = subjectsOf(record)
  if (subjects.length < 2) return fundDataErr(1, "至少提供两只基金的名称或备案号，用逗号分开")

  const misses: Array<{ query: string; reason: string }> = []
  const resolved: Array<{ query: string; reg_code: string; name: string; nav_scope: string; latest: string | null; inception: string | null }> = []
  for (const subject of subjects) {
    const hits = await lookupFundQueryHits(subject)
    const families = new Set(hits.map((hit) => hit.registerNumber.trim().toUpperCase()))
    if (hits.length === 0) {
      misses.push({ query: subject, reason: "数据库中未找到匹配基金" })
      continue
    }
    if (families.size > 1) {
      misses.push({ query: subject, reason: "名称对应多只基金，请改用备案号" })
      continue
    }
    const recordRow = await loadCompareFundRecord(hits[0].registerNumber)
    if (!recordRow) {
      misses.push({ query: subject, reason: "数据库中未找到匹配基金" })
      continue
    }
    resolved.push({
      query: subject,
      reg_code: recordRow.register_number,
      name: recordRow.fund_name,
      nav_scope: hits[0].navScope,
      latest: recordRow.latest_nav_date,
      inception: recordRow.inception_date,
    })
  }
  if (misses.length > 0) {
    return fundDataErr(1, misses.map((miss) => `${miss.query}：${miss.reason}`).join("；"))
  }

  const window = resolveCompareWindow({
    period: record.period,
    startDate: record.start_date,
    endDate: record.end_date,
    latestDates: resolved.map((row) => row.latest || ""),
    inceptionDates: resolved.map((row) => row.inception || ""),
  })
  if (!window) return fundDataErr(1, "无法确定对比区间")

  const align = (record.align ?? "1").trim() !== "0"
  const benchmarkKey = (record.benchmark ?? "IF").trim()
  const useBenchmark = benchmarkKey !== "" && benchmarkKey !== "none" && benchmarkKey !== "无"

  try {
    const { GET } = await import("@/app/ma/api/tracking-funds/chart-preview/route")
    const series = await Promise.all(resolved.map(async (fund) => {
      const params = new URLSearchParams({
        beian_hao: fund.reg_code,
        product_name: fund.name,
        from: window.start_date,
        to: window.end_date,
        mode: "return",
      })
      const res = await GET(new Request(`http://internal/ma/api/tracking-funds/chart-preview?${params}`))
      const json = await res.json() as { fund?: CurvePoint[] }
      const points = Array.isArray(json.fund) ? json.fund : []
      return { ...fund, points }
    }))
    const aligned = alignReturnCurves(series, align)
    const overlapStart = aligned.reduce((min, item) => {
      const start = item.points[0]?.d ?? ""
      if (!start) return min
      return !min || start < min ? start : min
    }, "")

    let benchmarkPoints: CurvePoint[] = []
    let benchmarkName: string | null = null
    if (useBenchmark) {
      if (!isPrivateFundBenchmarkKey(benchmarkKey)) return fundDataErr(1, "benchmark 不是页面上的基准代码")
      const { loadPrivateFundBenchmarkSeries } = await import("@/lib/server/private-fund-benchmarks")
      const bench = await loadPrivateFundBenchmarkSeries(benchmarkKey, window.start_date, window.end_date)
      benchmarkName = bench.label || privateFundBenchmarkLabel(benchmarkKey)
      benchmarkPoints = overlapStart
        ? clipBenchmarkReturns(bench.data.map((row) => ({ d: row.date.slice(0, 10), v: row.value })), overlapStart)
        : []
    }

    const metrics = buildCompareMetricsRows(
      aligned.map((fund) => ({ key: fund.reg_code, name: fund.name, returnPoints: fund.points })),
      benchmarkPoints.length > 0 && benchmarkName
        ? { key: benchmarkKey, name: benchmarkName, returnPoints: benchmarkPoints }
        : undefined,
    )

    const { loadFundIntervalMetrics, loadBenchmarkIntervalMetrics } = await import("@/lib/server/fund-compare-interval-metrics")
    const intervals = await loadFundIntervalMetrics(resolved.map((fund) => fund.reg_code))
    const benchmarkInterval = useBenchmark && isPrivateFundBenchmarkKey(benchmarkKey)
      ? await loadBenchmarkIntervalMetrics(benchmarkKey)
      : null

    return fundDataOk({
      period: window.period,
      start_date: window.start_date,
      end_date: window.end_date,
      align_start: align,
      overlap_start: overlapStart || null,
      benchmark: useBenchmark ? benchmarkKey : null,
      benchmark_name: benchmarkName,
      funds: resolved.map((fund) => ({
        query: fund.query,
        reg_code: fund.reg_code,
        name: fund.name,
        nav_scope: fund.nav_scope,
      })),
      rows: metrics.map((row) => ({
        reg_code: row.key,
        name: row.name,
        is_benchmark: row.isBenchmark,
        nav_from: row.navFrom,
        nav_to: row.navTo,
        period_return_pct: round(row.metrics.periodReturn, 2),
        ann_return_pct: round(row.metrics.annReturn, 2),
        ann_vol_pct: round(row.metrics.annVol, 2),
        sharpe: round(row.metrics.sharpe, 4),
        calmar: round(row.metrics.calmar, 4),
        sortino: round(row.metrics.sortino, 4),
        downside_risk_pct: round(row.metrics.downsideRisk, 2),
        max_drawdown_pct: round(row.metrics.maxDrawdown, 2),
        max_dd_recovery_days: row.metrics.maxDdRecoveryDays,
        longest_no_new_high_days: row.metrics.longestNoNewHighDays,
      })),
      intervals: [...intervals, ...(benchmarkInterval ? [benchmarkInterval] : [])].map((row) => ({
        reg_code: row.key,
        name: row.name,
        is_benchmark: row.isBenchmark,
        metric_date: row.metricDate,
        ret_1w_pct: row.metrics.ret_1w,
        ret_1m_pct: row.metrics.ret_1m,
        ret_3m_pct: row.metrics.ret_3m,
        ret_6m_pct: row.metrics.ret_6m,
        ret_1y_pct: row.metrics.ret_1y,
        sharpe_1y: row.metrics.sharpe_1y,
        calmar_1y: row.metrics.calmar_1y,
      })),
      note: NOTE,
    })
  } catch (err) {
    return fundDataErr(3, messageOf(err))
  }
}
