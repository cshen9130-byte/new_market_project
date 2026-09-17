/**
 * JY 跟踪池周度归因分析 Word 报告：
 * 各策略分组本周赢家 → OLS 拆分市场 beta vs 基金 alpha → 结合投资笔记 / 路演 / 知识库给出可延续的买入建议。
 */

import { execFile } from "child_process"
import { randomUUID } from "crypto"
import { existsSync } from "fs"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { promisify } from "util"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { query } from "@/lib/db"
import { noteAssociatesToProduct, type InvestmentNote } from "@/lib/ma/investment-notes"
import {
  computeStyleAttribution,
  type FactorDef,
  type StyleAttributionResult,
} from "@/lib/style-attribution"
import { getServerDueDiligenceTable } from "@/lib/server/due-diligence-table"
import { listAllTeamSharedNotes } from "@/lib/server/investment-notes"
import {
  BENCH_BY_BUCKET,
  buildMarketRows,
  computeFundMetrics,
  defaultWeeklyReviewWeekEnd,
  displayName,
  isEquityFund,
  isValidWeeklyReviewJobId,
  loadAshareCloses,
  loadJyTrackingPoolFunds,
  loadSpotCloses,
  loadWeeklyReviewNavHistories,
  metricModeForBucket,
  pickSeries,
  resolveWeekWindow,
  type FundMetrics,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"
import {
  addDays,
  NAV_HISTORY_LOOKBACK_DAYS,
  type NavPoint,
} from "@/lib/server/list-cache-nav-batch"

const execFileAsync = promisify(execFile)
const JOB_ROOT = path.join(process.cwd(), ".tmp", "jy-weekly-attribution")
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "ma", "generate_jy_weekly_attribution_report.py")
const REQUIRED_IMPORTS = "import matplotlib, numpy, docx"
const PYTHON_DEPS_PROBE_TIMEOUT_MS = 60_000
const TOP_PER_BUCKET = 4
const MAX_RECOMMENDATIONS = 10
const WINNERS_PER_BUCKET_MIN_RET = 0

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
}

let cachedPython: PythonInvocation | null = null

export type AttributionJobPhase = "pending" | "running" | "done" | "error"

export type AttributionJobStatus = {
  status: AttributionJobPhase
  jobId: string
  updatedAt: string
  error?: string
  fileName?: string
  phase?: string
  winnerCount?: number
  recommendCount?: number
}

const FACTOR_UNIVERSE: Array<{ key: string; name: string; codes: string[]; spot?: string }> = [
  { key: "csi300", name: "沪深300", codes: ["000300.SH", "000300"], spot: "IF" },
  { key: "csi500", name: "中证500", codes: ["000905.SH", "000905"], spot: "IC" },
  { key: "csi1000", name: "中证1000", codes: ["000852.SH", "000852"], spot: "IM" },
  { key: "csi2000", name: "中证2000", codes: ["932000.CSI", "932000.SH", "932000"] },
  { key: "a500", name: "中证A500", codes: ["000510.SH", "000510", "399850.SZ"] },
  { key: "cyb", name: "创业板指", codes: ["399006.SZ", "399006"] },
  { key: "growth", name: "大盘成长", codes: ["399372.SZ", "399372"] },
  { key: "value", name: "小盘价值", codes: ["399377.SZ", "399377"] },
  { key: "micro", name: "微盘股", codes: ["399303.SZ", "399303"] },
]

const BUCKET_PRIMARY_FACTOR: Record<string, string> = {
  "500指增": "csi500",
  "1000指增": "csi1000",
  "2000指增": "csi2000",
  "2000指增T0": "csi2000",
  指增T0: "csi2000",
  "300指增": "csi300",
  "A500指增": "a500",
  指数增强: "csi500",
  高换手: "csi500",
  中换手: "csi500",
  低换手: "csi500",
  空气指增: "csi500",
  量化中性: "csi500",
  中性: "csi500",
  打板: "micro",
  强势股: "cyb",
  择时择股: "csi300",
  可转债: "csi300",
  转债策略: "csi300",
  DMA: "csi500",
  股票多空: "csi300",
  港股对冲: "csi300",
}

type Driver = "alpha" | "beta" | "mixed"

type FactorWeekRow = {
  key: string
  name: string
  beta: number
  tStat: number
  pValue: number
  weekReturn: number | null
  weekContribution: number | null
}

type NoteExcerpt = { title: string; date: string; excerpt: string }
type RoadshowExcerpt = {
  date: string
  company: string
  manager: string
  method: string
  product: string
  conclusion: string
}
type KbExcerpt = { source: string; excerpt: string }

export type AttributionFundPayload = {
  beian_hao: string
  name: string
  bucket: string
  mode: "excess" | "absolute"
  manager: string | null
  week_ret: number | null
  week_excess: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
  driver: Driver
  driver_label: string
  week_beta: number | null
  week_alpha: number | null
  alpha_share: number | null
  r_squared: number | null
  adj_r2: number | null
  alpha_weekly: number | null
  alpha_tstat: number | null
  n_obs: number
  persist_4w: number | null
  persist_12w: number | null
  buy_score: number
  recommend: boolean
  thesis: string
  continuation: string
  risks: string
  factors: FactorWeekRow[]
  notes: NoteExcerpt[]
  roadshows: RoadshowExcerpt[]
  kb: KbExcerpt[]
  series: { dates: string[]; fund_cum: number[]; factor_cum: number[]; alpha_cum: number[] }
}

type GroupPayload = {
  bucket: string
  mode: "excess" | "absolute"
  count: number
  winners: AttributionFundPayload[]
}

type ReportPayload = {
  week_start: string
  week_end: string
  as_of: string
  range_label: string
  fund_count: number
  winner_count: number
  recommend_count: number
  methodology: string[]
  market: Awaited<ReturnType<typeof buildMarketRows>>
  groups: GroupPayload[]
  recommendations: AttributionFundPayload[]
  generated_at: string
}

function navValue(p: NavPoint | null | undefined): number | null {
  if (!p) return null
  const v = p.return_nav ?? p.nav
  return Number.isFinite(v) && v > 0 ? v : null
}

function closeOnOrBefore(series: Map<string, number>, date: string): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null
  for (const [d, v] of series) {
    if (d <= date && (best == null || d > best.date)) best = { date: d, value: v }
  }
  return best
}

function periodReturn(series: Map<string, number>, endDate: string, startDate: string): number | null {
  const end = closeOnOrBefore(series, endDate)
  const start = closeOnOrBefore(series, startDate)
  if (!end || !start || start.date >= end.date || start.value <= 0) return null
  const ret = end.value / start.value - 1
  return Number.isFinite(ret) ? ret : null
}

function xmlSafeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u2028\u2029\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
}

function sanitizeForXml(value: unknown): unknown {
  if (typeof value === "string") return xmlSafeText(value)
  if (Array.isArray(value)) return value.map(sanitizeForXml)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeForXml(item)]),
    )
  }
  return value
}

function htmlToPlain(html: string): string {
  return xmlSafeText(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim(),
  )
}

function excerptAround(text: string, needles: string[], maxLen = 420): string {
  if (!text) return ""
  const lower = text.toLowerCase()
  let idx = -1
  for (const n of needles) {
    if (!n || n.length < 2) continue
    const i = text.indexOf(n)
    const j = lower.indexOf(n.toLowerCase())
    const hit = i >= 0 ? i : j
    if (hit >= 0 && (idx < 0 || hit < idx)) idx = hit
  }
  if (idx < 0) return text.slice(0, maxLen)
  const start = Math.max(0, idx - 80)
  return (start > 0 ? "…" : "") + text.slice(start, start + maxLen)
}

function clip(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function driverLabel(driver: Driver): string {
  if (driver === "alpha") return "阿尔法驱动"
  if (driver === "beta") return "市场/风格贝塔驱动"
  return "混合（部分超额）"
}

function factorDefsForBucket(bucket: string, nObs: number, available: Set<string>): FactorDef[] {
  const primary = BUCKET_PRIMARY_FACTOR[bucket] || "csi300"
  const keys: string[] = []
  const extras = [primary, "csi300", "csi500", "csi1000", "cyb", "growth", "micro"]
  for (const key of extras) {
    if (!available.has(key) || keys.includes(key)) continue
    keys.push(key)
  }
  if (keys.length === 0 && available.has("csi300")) keys.push("csi300")
  const maxFactors = clip(Math.floor(nObs / 8), 1, 5)
  return keys.slice(0, Math.max(1, maxFactors)).map((key) => {
    const def = FACTOR_UNIVERSE.find((f) => f.key === key)!
    return { key: def.key, name: def.name }
  }).filter((d) => d)
}

function alignedReturns(
  fundHist: NavPoint[],
  factorSeries: Record<string, Map<string, number>>,
  factorKeys: string[],
  asOf: string,
): { dates: string[]; fund: number[]; factors: Record<string, number[]> } | null {
  const points = fundHist
    .filter((p) => p.nav_date <= asOf)
    .map((p) => ({ date: p.nav_date, value: navValue(p) }))
    .filter((p): p is { date: string; value: number } => p.value != null && p.value > 0)
  if (points.length < 12) return null

  const since = addDays(asOf, 400)
  const sliced = points.filter((p) => p.date >= since)
  const use = sliced.length >= 16 ? sliced : points.slice(-80)
  if (use.length < 12) return null

  const dates: string[] = []
  const fund: number[] = []
  const factors: Record<string, number[]> = Object.fromEntries(factorKeys.map((k) => [k, []]))

  for (let i = 1; i < use.length; i++) {
    const prev = use[i - 1]
    const cur = use[i]
    const fr = cur.value / prev.value - 1
    if (!Number.isFinite(fr)) continue
    const row: Record<string, number> = {}
    let ok = true
    for (const key of factorKeys) {
      const series = factorSeries[key]
      if (!series) {
        ok = false
        break
      }
      const pr = periodReturn(series, cur.date, prev.date)
      if (pr == null) {
        ok = false
        break
      }
      row[key] = pr
    }
    if (!ok) continue
    dates.push(cur.date)
    fund.push(fr)
    for (const key of factorKeys) factors[key].push(row[key])
  }
  if (fund.length < 10) return null
  return { dates, fund, factors }
}

function lastWeekIndex(dates: string[], weekStart: string, weekEnd: string): number {
  let idx = -1
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= weekStart && dates[i] <= weekEnd) idx = i
  }
  if (idx < 0) {
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= weekEnd) return i
    }
  }
  return idx
}

function residualWindow(explained: StyleAttributionResult, endIdx: number, n: number): number | null {
  const start = Math.max(0, endIdx - n + 1)
  if (endIdx < start) return null
  const before = start > 0 ? (explained.explainedReturns[start - 1]?.idiosyncraticReturn ?? 0) : 0
  const a1 = explained.explainedReturns[endIdx]?.idiosyncraticReturn ?? 0
  const value = a1 - before
  return Number.isFinite(value) ? value : null
}

function classifyDriver(opts: {
  weekRet: number | null
  weekBeta: number | null
  weekAlpha: number | null
  r2: number | null
  alphaT: number | null
  persist4w: number | null
  persist12w: number | null
}): { driver: Driver; alphaShare: number | null } {
  const { weekRet, weekBeta, weekAlpha, r2, alphaT, persist4w, persist12w } = opts
  if (weekAlpha == null || weekBeta == null) {
    return { driver: "mixed", alphaShare: null }
  }
  const absA = Math.abs(weekAlpha)
  const absB = Math.abs(weekBeta)
  const alphaShare = absA + absB > 1e-9 ? absA / (absA + absB) : null
  const persist = (persist4w ?? 0) > 0 || (persist12w ?? 0) > 0
  const alphaPositive = weekAlpha > 0.003
  const tOk = (alphaT ?? 0) > 1.15
  if (alphaPositive && (alphaShare ?? 0) >= 0.55 && (persist || tOk || (weekRet ?? 0) > 0.01)) {
    return { driver: "alpha", alphaShare }
  }
  if ((alphaShare ?? 0) <= 0.4 && (r2 ?? 0) >= 0.55 && (weekBeta ?? 0) > (weekAlpha ?? 0)) {
    return { driver: "beta", alphaShare }
  }
  if (alphaPositive && persist && (alphaShare ?? 0) >= 0.4) {
    return { driver: "alpha", alphaShare }
  }
  return { driver: "mixed", alphaShare }
}

function buyScore(row: {
  driver: Driver
  weekAlpha: number | null
  alphaShare: number | null
  persist4w: number | null
  persist12w: number | null
  alphaT: number | null
  hasQual: boolean
  weekRet: number | null
}): number {
  const alphaClip = clip((row.weekAlpha ?? 0) / 0.02, 0, 1)
  const share = row.alphaShare ?? 0
  const persist = (row.persist4w ?? 0) > 0 ? 1 : (row.persist12w ?? 0) > 0 ? 0.5 : 0
  const t = clip((row.alphaT ?? 0) / 2, 0, 1)
  const driverBoost = row.driver === "alpha" ? 1 : row.driver === "mixed" ? 0.45 : 0
  const retBoost = (row.weekRet ?? 0) > 0 ? 1 : 0
  return Math.round(
    32 * alphaClip +
      18 * share +
      16 * persist +
      12 * t +
      12 * driverBoost +
      6 * (row.hasQual ? 1 : 0) +
      4 * retBoost,
  )
}

function templateThesis(row: AttributionFundPayload): { thesis: string; continuation: string; risks: string } {
  const week = row.week_ret == null ? "—" : `${(row.week_ret * 100).toFixed(2)}%`
  const alpha = row.week_alpha == null ? "—" : `${(row.week_alpha * 100).toFixed(2)}%`
  const beta = row.week_beta == null ? "—" : `${(row.week_beta * 100).toFixed(2)}%`
  const r2 = row.r_squared == null ? "—" : row.r_squared.toFixed(2)
  const noteHint = row.notes[0]?.excerpt || row.roadshows[0]?.conclusion || row.kb[0]?.excerpt || ""
  const thesis =
    `${row.name}（${row.bucket}）本周收益 ${week}，其中市场/风格解释约 ${beta}，特质超额约 ${alpha}，判定为${row.driver_label}。` +
    `样本期回归 R²=${r2}` +
    (row.alpha_tstat != null ? `，截距 t=${row.alpha_tstat.toFixed(2)}` : "") +
    "。" +
    (noteHint ? `路演/笔记线索：${noteHint.slice(0, 180)}` : "公开净值路径显示其超额并非单周市场贝塔的简单映射。")
  const continuation =
    (row.persist_4w ?? 0) > 0
      ? "近四周累积特质收益仍为正，超额未在当周一次性耗尽，短周期延续性好于纯交易型脉冲。"
      : "近四周特质收益偏弱，需把本周超额当作信号而非趋势，等待下一两周净值确认。"
  const extra =
    row.mode === "excess"
      ? "指增产品关注超额相对基准是否稳定、拥挤度与容量。"
      : "主动股票关注风格切换后选股/交易优势是否仍在。"
  const risks = `若下周风格与本周高度同向而超额转负，则本周更可能是拥挤交易或风格贝塔的滞后体现。${extra}`
  return { thesis, continuation, risks }
}

function noteMatchesFund(note: InvestmentNote, fund: WeeklyReviewFund): boolean {
  const beian = fund.beian_hao.trim()
  const names = [fund.product_name, fund.short_name ?? ""].map((s) => s.trim()).filter((s) => s.length >= 2)
  if (noteAssociatesToProduct(note, beian, fund.product_name)) return true
  if (noteAssociatesToProduct(note, beian, fund.short_name ?? undefined)) return true
  for (const p of note.extractedProducts ?? []) {
    const rec = (p.recordNo || "").trim()
    if (rec && rec.toUpperCase() === beian.toUpperCase()) return true
    if (names.some((n) => n.length >= 4 && ((p.name || "").includes(n) || n.includes(p.name || "")))) return true
  }
  for (const r of note.roadshowAssociations ?? []) {
    const prod = (r.representativeProduct || "").trim()
    if (prod && names.some((n) => n.length >= 4 && (prod.includes(n) || n.includes(prod)))) return true
  }
  const hay = `${note.title} ${htmlToPlain(note.content || "").slice(0, 800)}`
  return names.some((n) => n.length >= 4 && hay.includes(n))
}

async function loadManagers(beians: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (beians.length === 0) return out
  const rows = await query<{ beian_hao: string; manager: string | null }>(
    `SELECT i.beian_hao,
            COALESCE(NULLIF(BTRIM(i.manager), ''), NULLIF(BTRIM(a.manager_name), '')) AS manager
     FROM private_fund_info i
     LEFT JOIN amac_private_funds a ON UPPER(BTRIM(a.fund_no)) = UPPER(BTRIM(i.beian_hao))
     WHERE i.beian_hao = ANY($1::text[])`,
    [beians],
  ).catch(() => [])
  for (const row of rows) {
    const m = (row.manager || "").trim()
    if (m) out.set(row.beian_hao, m)
  }
  return out
}

async function loadKbExcerpts(needles: string[]): Promise<KbExcerpt[]> {
  const terms = [...new Set(needles.map((s) => s.trim()).filter((s) => s.length >= 4))].slice(0, 4)
  if (terms.length === 0) return []
  const clauses = terms.map((_, i) => `content ILIKE $${i + 1}`)
  const params = terms.map((t) => `%${t}%`)
  const rows = await query<{ source: string; snippet: string }>(
    `SELECT source, LEFT(content, 900) AS snippet
     FROM kb_chunks
     WHERE ${clauses.join(" OR ")}
     ORDER BY
       CASE WHEN source ILIKE '%内部尽调%' OR source ILIKE '%路演%' OR source ILIKE '%投资笔记%' THEN 0 ELSE 1 END,
       source
     LIMIT 12`,
    params,
  ).catch(() => [])
  const bySource = new Map<string, KbExcerpt>()
  for (const row of rows) {
    if (bySource.has(row.source)) continue
    bySource.set(row.source, {
      source: row.source.replace(/^\/+/, ""),
      excerpt: excerptAround(row.snippet || "", terms, 360),
    })
  }
  return [...bySource.values()].slice(0, 3)
}

function parseLlmJson(text: string): Array<{ beian_hao?: string; thesis?: string; continuation?: string; risks?: string }> {
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : raw).trim()
  const start = body.indexOf("[")
  const end = body.lastIndexOf("]")
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function enrichWithLlm(funds: AttributionFundPayload[]): Promise<void> {
  if (funds.length === 0) return
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) return
  try {
    const model = new ChatOpenAI({
      apiKey,
      model: process.env.DASHSCOPE_ANALYSIS_MODEL || process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
      temperature: 0.25,
      streaming: false,
      configuration: {
        baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
      },
    })
    const compact = funds.map((f) => ({
      beian_hao: f.beian_hao,
      name: f.name,
      bucket: f.bucket,
      driver: f.driver_label,
      week_ret: f.week_ret,
      week_alpha: f.week_alpha,
      week_beta: f.week_beta,
      r2: f.r_squared,
      alpha_t: f.alpha_tstat,
      persist_4w: f.persist_4w,
      notes: f.notes.map((n) => n.excerpt).slice(0, 2),
      roadshows: f.roadshows.map((r) => `${r.date} ${r.company} ${r.conclusion}`.trim()).slice(0, 2),
      kb: f.kb.map((k) => k.excerpt).slice(0, 2),
      factors: f.factors.map((x) => ({ name: x.name, beta: x.beta, week: x.weekContribution })),
    }))
    const res = await model.invoke([
      new SystemMessage(
        "你是私募FOF研究员。根据净值回归与路演/笔记摘录，判断本周赢家的超额是否更可能来自可延续的选股/交易alpha，而非市场beta。用中文，务实、可证伪，不要编造没有出现的事实。",
      ),
      new HumanMessage(
        `请为下列产品各写三段：thesis（本周为何更像alpha）、continuation（为何可能延续到后续一周）、risks（失效条件）。\n` +
          `只输出 JSON 数组，每项字段：beian_hao, thesis, continuation, risks。每段不超过120字。\n` +
          JSON.stringify(compact),
      ),
    ])
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content)
    const parsed = parseLlmJson(text)
    const byBeian = new Map(parsed.map((row) => [String(row.beian_hao || "").trim().toUpperCase(), row]))
    for (const fund of funds) {
      const hit = byBeian.get(fund.beian_hao.toUpperCase())
      if (!hit) continue
      if (hit.thesis?.trim()) fund.thesis = hit.thesis.trim()
      if (hit.continuation?.trim()) fund.continuation = hit.continuation.trim()
      if (hit.risks?.trim()) fund.risks = hit.risks.trim()
    }
  } catch (err) {
    console.warn("[jy-weekly-attribution] LLM enrich skipped:", err instanceof Error ? err.message : err)
  }
}

async function analyzeFund(opts: {
  fund: WeeklyReviewFund
  metrics: FundMetrics
  history: NavPoint[]
  factorSeries: Record<string, Map<string, number>>
  weekStart: string
  weekEnd: string
  asOf: string
  manager: string | null
  notes: InvestmentNote[]
  roadshows: RoadshowExcerpt[]
}): Promise<AttributionFundPayload> {
  const { fund, metrics, history, factorSeries, weekStart, weekEnd, asOf, manager, notes, roadshows } = opts
  const available = new Set(
    Object.entries(factorSeries)
      .filter(([, series]) => series && series.size >= 2)
      .map(([key]) => key),
  )
  const defs = factorDefsForBucket(metrics.bucket, 40, available)
  const aligned = defs.length ? alignedReturns(history, factorSeries, defs.map((d) => d.key), asOf) : null
  let attribution: StyleAttributionResult | null = null
  if (aligned) {
    let usedDefs = factorDefsForBucket(metrics.bucket, aligned.fund.length, available)
    usedDefs = usedDefs.filter((d) => (aligned.factors[d.key]?.length ?? 0) === aligned.fund.length)
    if (usedDefs.length) {
      const factorReturns: Record<string, number[]> = {}
      for (const def of usedDefs) factorReturns[def.key] = aligned.factors[def.key] ?? []
      attribution = computeStyleAttribution({
        dates: aligned.dates,
        fundReturns: aligned.fund,
        factorReturns,
        factorDefs: usedDefs,
        includeIntercept: true,
      })
      if (!attribution && usedDefs.length > 1) {
        attribution = computeStyleAttribution({
          dates: aligned.dates,
          fundReturns: aligned.fund,
          factorReturns: { [usedDefs[0].key]: aligned.factors[usedDefs[0].key] ?? [] },
          factorDefs: usedDefs.slice(0, 1),
          includeIntercept: true,
        })
      }
    }
  }

  const weekIdx = attribution ? lastWeekIndex(attribution.explainedReturns.map((p) => p.date), weekStart, weekEnd) : -1
  const weekRet = metrics.mode === "excess" ? metrics.excess.ret_1w : metrics.ret.ret_1w
  let weekBeta: number | null = null
  let weekAlpha: number | null = null
  const factorRows: FactorWeekRow[] = []

  if (attribution && weekIdx >= 0 && aligned) {
    let betaSum = 0
    for (const f of attribution.factors) {
      const wr = aligned.factors[f.factorKey]?.[weekIdx] ?? null
      const contrib = wr == null ? null : f.coefficient * wr
      if (contrib != null) betaSum += contrib
      factorRows.push({
        key: f.factorKey,
        name: f.factorName,
        beta: f.coefficient,
        tStat: f.tStat,
        pValue: f.pValue,
        weekReturn: wr,
        weekContribution: contrib,
      })
    }
    const actual = aligned.fund[weekIdx] ?? weekRet ?? 0
    weekBeta = betaSum
    weekAlpha = actual - betaSum
  }

  const persist4w = attribution && weekIdx >= 0 ? residualWindow(attribution, weekIdx, 4) : null
  const persist12w = attribution && weekIdx >= 0 ? residualWindow(attribution, weekIdx, 12) : null
  const alphaWeekly = attribution?.intercept?.coefficient ?? null
  const alphaT = attribution?.intercept?.tStat ?? null
  const { driver: finalDriver, alphaShare: finalShare } = classifyDriver({
    weekRet,
    weekBeta,
    weekAlpha,
    r2: attribution?.summary.rSquared ?? null,
    alphaT,
    persist4w,
    persist12w,
  })

  const noteExcerpts: NoteExcerpt[] = notes.slice(0, 3).map((n) => ({
    title: xmlSafeText(n.title || "投资笔记"),
    date: xmlSafeText(n.modifiedDate || n.createdDate || ""),
    excerpt: excerptAround(htmlToPlain(n.content || n.preview || ""), [
      fund.product_name,
      fund.short_name || "",
      "超额",
      "选股",
      "指增",
      "alpha",
      "拥挤",
      "容量",
    ]),
  }))

  const kbNeedles = [fund.product_name, fund.short_name || "", manager || ""].filter(Boolean)
  const kb = await loadKbExcerpts(kbNeedles)

  const series = attribution
    ? {
        dates: attribution.explainedReturns.map((p) => p.date),
        fund_cum: attribution.explainedReturns.map((p) => p.productReturn),
        factor_cum: attribution.explainedReturns.map((p) => p.factorReturn),
        alpha_cum: attribution.explainedReturns.map((p) => p.idiosyncraticReturn),
      }
    : { dates: [] as string[], fund_cum: [] as number[], factor_cum: [] as number[], alpha_cum: [] as number[] }

  const payload: AttributionFundPayload = {
    beian_hao: fund.beian_hao,
    name: xmlSafeText(displayName(fund.product_name, fund.short_name)),
    bucket: metrics.bucket,
    mode: metrics.mode,
    manager,
    week_ret: weekRet,
    week_excess: metrics.excess.ret_1w,
    ret_1m: metrics.mode === "excess" ? metrics.excess.ret_1m : metrics.ret.ret_1m,
    ret_3m: metrics.mode === "excess" ? metrics.excess.ret_3m : metrics.ret.ret_3m,
    ret_6m: metrics.mode === "excess" ? metrics.excess.ret_6m : metrics.ret.ret_6m,
    ret_1y: metrics.mode === "excess" ? metrics.excess.ret_1y : metrics.ret.ret_1y,
    sharpe_1y: metrics.sharpe_1y,
    calmar_1y: metrics.calmar_1y,
    driver: finalDriver,
    driver_label: driverLabel(finalDriver),
    week_beta: weekBeta,
    week_alpha: weekAlpha,
    alpha_share: finalShare,
    r_squared: attribution?.summary.rSquared ?? null,
    adj_r2: attribution?.summary.adjRSquared ?? null,
    alpha_weekly: alphaWeekly,
    alpha_tstat: alphaT,
    n_obs: attribution?.summary.navCount ?? 0,
    persist_4w: persist4w,
    persist_12w: persist12w,
    buy_score: 0,
    recommend: false,
    thesis: "",
    continuation: "",
    risks: "",
    factors: factorRows,
    notes: noteExcerpts,
    roadshows,
    kb,
    series,
  }
  payload.buy_score = buyScore({
    driver: payload.driver,
    weekAlpha: payload.week_alpha,
    alphaShare: payload.alpha_share,
    persist4w: payload.persist_4w,
    persist12w: payload.persist_12w,
    alphaT: payload.alpha_tstat,
    hasQual: payload.notes.length + payload.roadshows.length + payload.kb.length > 0,
    weekRet: payload.week_ret,
  })
  const filled = templateThesis(payload)
  payload.thesis = filled.thesis
  payload.continuation = filled.continuation
  payload.risks = filled.risks
  return payload
}

function pickWinners(rows: FundMetrics[]): FundMetrics[] {
  const sorted = [...rows].sort((a, b) => {
    const av = a.mode === "excess" ? a.excess.ret_1w : a.ret.ret_1w
    const bv = b.mode === "excess" ? b.excess.ret_1w : b.ret.ret_1w
    return (bv ?? -Infinity) - (av ?? -Infinity)
  })
  const positive = sorted.filter((r) => {
    const v = r.mode === "excess" ? r.excess.ret_1w : r.ret.ret_1w
    return v != null && v > WINNERS_PER_BUCKET_MIN_RET
  })
  const pool = positive.length > 0 ? positive : sorted.filter((r) => (r.mode === "excess" ? r.excess.ret_1w : r.ret.ret_1w) != null)
  return pool.slice(0, TOP_PER_BUCKET)
}

function selectRecommendations(analyzed: AttributionFundPayload[]): AttributionFundPayload[] {
  const ranked = [...analyzed].sort((a, b) => b.buy_score - a.buy_score)
  const picked: AttributionFundPayload[] = []
  const seenBucket = new Set<string>()
  for (const row of ranked) {
    if (row.driver === "beta") continue
    if ((row.week_alpha ?? 0) <= 0 && row.driver !== "alpha") continue
    if (row.buy_score < 42) continue
    if (picked.length >= MAX_RECOMMENDATIONS) break
    picked.push(row)
    seenBucket.add(row.bucket)
  }
  // Ensure at least one alpha/mixed name per strong bucket if score is close.
  for (const row of ranked) {
    if (picked.length >= MAX_RECOMMENDATIONS) break
    if (seenBucket.has(row.bucket)) continue
    if (row.driver === "beta") continue
    if (row.buy_score < 38) continue
    picked.push(row)
    seenBucket.add(row.bucket)
  }
  for (const row of picked) row.recommend = true
  return picked.sort((a, b) => b.buy_score - a.buy_score)
}

export async function buildWeeklyAttributionPayload(weekEndRaw: string): Promise<ReportPayload> {
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw)
  const funds = (await loadJyTrackingPoolFunds()).filter(isEquityFund)
  if (funds.length === 0) throw new Error("JY跟踪池中没有可分析的股票策略产品")

  const histories = await loadWeeklyReviewNavHistories(funds, asOf)
  const [metrics, market] = await Promise.all([
    computeFundMetrics(funds, asOf, histories),
    buildMarketRows(weekStart, weekEnd),
  ])

  const from = addDays(asOf, NAV_HISTORY_LOOKBACK_DAYS + 40)
  const allCodes = [...new Set(FACTOR_UNIVERSE.flatMap((f) => f.codes))]
  const spots = FACTOR_UNIVERSE.map((f) => f.spot).filter((s): s is string => !!s)
  const extraBench = [...new Set(Object.values(BENCH_BY_BUCKET).flat())]
  const [ashare, spot] = await Promise.all([
    loadAshareCloses([...new Set([...allCodes, ...extraBench])], from, asOf),
    loadSpotCloses([...new Set([...spots, "IH", "IF", "IC", "IM"])], from, asOf),
  ])

  const factorSeries: Record<string, Map<string, number>> = {}
  for (const def of FACTOR_UNIVERSE) {
    const picked = pickSeries(ashare, spot, def.codes, def.spot)
    if (picked) factorSeries[def.key] = picked.series
  }

  const fundByBeian = new Map(funds.map((f) => [f.beian_hao, f]))
  const groupsMap = new Map<string, FundMetrics[]>()
  for (const row of metrics) {
    const list = groupsMap.get(row.bucket) ?? []
    list.push(row)
    groupsMap.set(row.bucket, list)
  }

  const winnerMetrics: FundMetrics[] = []
  for (const rows of groupsMap.values()) {
    winnerMetrics.push(...pickWinners(rows))
  }

  const winnerBeians = winnerMetrics.map((m) => m.beian_hao)
  const [managers, teamNotes, ddTable] = await Promise.all([
    loadManagers(winnerBeians),
    Promise.resolve(listAllTeamSharedNotes()),
    getServerDueDiligenceTable().catch(() => null),
  ])

  const analyzed: AttributionFundPayload[] = []
  for (const row of winnerMetrics) {
    const fund = fundByBeian.get(row.beian_hao)
    if (!fund) continue
    const names = [fund.product_name, fund.short_name ?? "", displayName(fund.product_name, fund.short_name)]
    const notes = teamNotes.filter((n) => noteMatchesFund(n, fund)).slice(0, 4)
    const roadshows: RoadshowExcerpt[] = []
    if (ddTable) {
      for (const dd of ddTable.rows) {
        const beian = (dd.representativeProductBeianHao || "").trim()
        const prod = (dd.representativeProduct || "").trim()
        const hit =
          (beian && beian.toUpperCase() === fund.beian_hao.toUpperCase()) ||
          names.some((n) => n && n.length >= 4 && prod && (prod.includes(n) || n.includes(prod)))
        if (!hit) continue
        roadshows.push({
          date: dd.ddDate || "",
          company: dd.fundCompany || dd.ddTarget || "",
          manager: dd.investmentManager || "",
          method: dd.ddMethod || "",
          product: dd.representativeProduct || "",
          conclusion: htmlToPlain(dd.ddConclusion || "").slice(0, 360),
        })
        if (roadshows.length >= 3) break
      }
    }
    analyzed.push(
      await analyzeFund({
        fund,
        metrics: row,
        history: histories.get(fund.beian_hao) ?? [],
        factorSeries,
        weekStart,
        weekEnd,
        asOf,
        manager: managers.get(fund.beian_hao) ?? null,
        notes,
        roadshows,
      }),
    )
  }

  const recommendations = selectRecommendations(analyzed)
  await enrichWithLlm(recommendations)

  const analyzedByBeian = new Map(analyzed.map((r) => [r.beian_hao, r]))
  const orderedBuckets = [...groupsMap.keys()].sort((a, b) => {
    const ia = bucketOrderIndex(a)
    const ib = bucketOrderIndex(b)
    return ia - ib || a.localeCompare(b, "zh")
  })

  const groups: GroupPayload[] = orderedBuckets.map((bucket) => {
    const rows = groupsMap.get(bucket) ?? []
    const winners = pickWinners(rows)
      .map((m) => analyzedByBeian.get(m.beian_hao))
      .filter((x): x is AttributionFundPayload => !!x)
    return {
      bucket,
      mode: metricModeForBucket(bucket),
      count: rows.length,
      winners,
    }
  }).filter((g) => g.winners.length > 0)

  return {
    week_start: weekStart,
    week_end: weekEnd,
    as_of: asOf,
    range_label: market.rangeLabel,
    fund_count: funds.length,
    winner_count: analyzed.length,
    recommend_count: recommendations.length,
    methodology: [
      "样本：JY跟踪池股票策略产品，分组与周报 Excel 一致。",
      "赢家：每个策略分组按本周收益（指增看超额）取前 4 名且收益为正。",
      "回归：以产品净值区间收益对宽基/风格指数做带截距 OLS，拆出本周 β·因子 与残差 α。",
      "过滤：优先保留本周 α 贡献占优、近 4/12 周特质收益仍为正的产品，剔除明显靠市场贝塔吃饭的赢家。",
      "质化：匹配团队投资笔记、尽调表格路演结论、AI 知识库切片，并在有模型密钥时生成延续性判断。",
    ],
    market,
    groups,
    recommendations,
    generated_at: new Date().toISOString(),
  }
}

function bucketOrderIndex(bucket: string): number {
  const order = [
    "500指增", "1000指增", "2000指增", "300指增", "A500指增", "指数增强",
    "高换手", "中换手", "低换手", "指增T0", "空气指增", "量化中性", "中性",
    "强势股", "择时择股", "可转债", "转债策略", "打板", "DMA", "股票多空", "港股对冲",
  ]
  const i = order.indexOf(bucket)
  return i >= 0 ? i : 999
}

function jobDir(jobId: string): string {
  return path.join(JOB_ROOT, jobId)
}

function jobStatusPath(jobId: string): string {
  return path.join(jobDir(jobId), "status.json")
}

function jobFilePath(jobId: string): string {
  return path.join(jobDir(jobId), "report.docx")
}

async function writeJobStatus(status: AttributionJobStatus): Promise<void> {
  await mkdir(jobDir(status.jobId), { recursive: true })
  await writeFile(jobStatusPath(status.jobId), JSON.stringify(status), "utf8")
}

export async function prepareWeeklyAttributionJob(): Promise<string> {
  const jobId = randomUUID()
  await writeJobStatus({
    status: "pending",
    jobId,
    updatedAt: new Date().toISOString(),
    phase: "排队中",
  })
  return jobId
}

export async function getWeeklyAttributionJobStatus(jobId: string): Promise<AttributionJobStatus> {
  if (!isValidWeeklyReviewJobId(jobId)) throw new Error("无效的任务 ID")
  const raw = await readFile(jobStatusPath(jobId), "utf8").catch(() => null)
  if (!raw) throw new Error("任务不存在")
  return JSON.parse(raw) as AttributionJobStatus
}

export async function readWeeklyAttributionJobFile(jobId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const status = await getWeeklyAttributionJobStatus(jobId)
  if (status.status !== "done" || !status.fileName) throw new Error("文件尚未生成")
  const buffer = await readFile(jobFilePath(jobId))
  return { buffer, fileName: status.fileName }
}

function pushPythonCandidate(out: PythonInvocation[], executable: string, prefixArgs: string[] = []) {
  if (!executable) return
  if (executable.includes("/") || executable.includes("\\") || executable.endsWith(".exe")) {
    if (!existsSync(executable)) return
  }
  if (out.some((item) => item.executable === executable && item.prefixArgs.join(" ") === prefixArgs.join(" "))) return
  out.push({ executable, prefixArgs })
}

function listPythonCandidates(): PythonInvocation[] {
  const cwd = process.cwd()
  const out: PythonInvocation[] = []
  for (const key of ["PYTHON_EXE", "PYTHON_EXECUTABLE"] as const) {
    pushPythonCandidate(out, process.env[key] ?? "")
  }
  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, path.join(cwd, "scripts", "ma", ".venv", "Scripts", "python.exe"))
    const localAppData = process.env.LOCALAPPDATA ?? ""
    pushPythonCandidate(out, path.join(localAppData, "Programs", "Python", "Launcher", "py.exe"), ["-3"])
    pushPythonCandidate(out, path.join(process.env.SystemRoot ?? "C:\\Windows", "py.exe"), ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
    pushPythonCandidate(out, "/root/new_market_project/.venv/bin/python3")
    pushPythonCandidate(out, "python3")
    pushPythonCandidate(out, "python")
  }
  return out
}

async function pythonHasDeps(invocation: PythonInvocation): Promise<boolean> {
  try {
    await execFileAsync(invocation.executable, [...invocation.prefixArgs, "-c", REQUIRED_IMPORTS], {
      timeout: PYTHON_DEPS_PROBE_TIMEOUT_MS,
      env: { ...process.env, PYTHONUTF8: "1", MPLBACKEND: "Agg" },
    })
    return true
  } catch {
    return false
  }
}

async function findPython(): Promise<PythonInvocation> {
  if (cachedPython) return cachedPython
  const candidates = listPythonCandidates()
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", ["py"], { timeout: 5000 })
      for (const line of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        pushPythonCandidate(candidates, line, ["-3"])
      }
    } catch { /* ignore */ }
  }
  for (const candidate of candidates) {
    if (await pythonHasDeps(candidate)) {
      cachedPython = candidate
      return candidate
    }
  }
  throw new Error("未找到带 matplotlib / python-docx 的 Python，无法生成 Word 报告")
}

async function renderWordReport(payload: ReportPayload, outDir: string, outFile: string): Promise<void> {
  const python = await findPython()
  const payloadPath = path.join(outDir, "payload.json")
  const chartsDir = path.join(outDir, "charts")
  await mkdir(chartsDir, { recursive: true })
  await writeFile(payloadPath, JSON.stringify(sanitizeForXml(payload)), "utf8")
  try {
    await execFileAsync(
      python.executable,
      [...python.prefixArgs, SCRIPT_PATH, "--input", payloadPath, "--output", outFile, "--charts-dir", chartsDir],
      {
        timeout: 180_000,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg" },
      },
    )
  } catch (err) {
    const stderr = typeof (err as { stderr?: string }).stderr === "string" ? (err as { stderr: string }).stderr.trim() : ""
    const message = err instanceof Error ? err.message : String(err)
    const tail = (stderr || message).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-2).join(" ")
    throw new Error(tail.slice(0, 400) || "Word 报告生成失败")
  }
}

export function defaultAttributionWeekEnd(): string {
  return defaultWeeklyReviewWeekEnd()
}

export async function runWeeklyAttributionJob(jobId: string, weekEnd: string): Promise<void> {
  await writeJobStatus({
    status: "running",
    jobId,
    updatedAt: new Date().toISOString(),
    phase: "正在筛选赢家并做收益归因",
  })
  try {
    const payload = await buildWeeklyAttributionPayload(weekEnd)
    await writeJobStatus({
      status: "running",
      jobId,
      updatedAt: new Date().toISOString(),
      phase: "正在生成 Word 报告",
      winnerCount: payload.winner_count,
      recommendCount: payload.recommend_count,
    })
    const dir = jobDir(jobId)
    await mkdir(dir, { recursive: true })
    const yy = payload.week_end.slice(2, 4)
    const mm = payload.week_end.slice(5, 7)
    const dd = payload.week_end.slice(8, 10)
    const fileName = `JY跟踪池周度归因分析 - ${yy}.${mm}.${dd}.docx`
    const outFile = jobFilePath(jobId)
    await renderWordReport(payload, dir, outFile)
    await writeJobStatus({
      status: "done",
      jobId,
      updatedAt: new Date().toISOString(),
      fileName,
      winnerCount: payload.winner_count,
      recommendCount: payload.recommend_count,
      phase: "完成",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[jy-weekly-attribution] job failed:", message)
    await writeJobStatus({
      status: "error",
      jobId,
      updatedAt: new Date().toISOString(),
      error: message,
    })
  }
}
