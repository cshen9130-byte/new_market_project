import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import {
  formatFundStrategyLabel,
  sqlResolvedStrategySelect,
  sqlType6LatestStrategyJoin,
  sqlType6TableResolvedStrategy,
} from "@/lib/server/fund-strategy-resolve"
import {
  addDays,
  BatchNavResolver,
  NAV_HISTORY_LOOKBACK_DAYS,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"
import { loadFundNavSeries, resolveFundNames } from "@/lib/server/fund-nav-series"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// ── LLM helpers ────────────────────────────────────────────────────────────────

function getChatModel(streaming = false) {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error("缺少 DASHSCOPE_API_KEY")
  return new ChatOpenAI({
    apiKey,
    model: process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
    temperature: 0.3,
    streaming,
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => { console.warn(`[similar-fund] ${label} timed out`); resolve(fallback) }, ms)),
  ])
}

// ── Types ───────────────────────────────────────────────────────────────────────

interface FundInfo {
  beian_hao: string
  product_name: string
  manager: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  inception_date: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  latest_nav: string | null
  latest_nav_date: string | null
}

interface NavPoint {
  price_date: string
  nav: string
  cumulative_nav: string | null
}

interface SimilarityResult {
  fund: FundInfo
  score: number
  correlation: number | null
  metricScore: number | null
  overlapMonths: number
  navPoints: number
  nav: NavPoint[]
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

const RISK_CACHE_JOIN = `LEFT JOIN ops_tracking_funds_list_cache cache
       ON UPPER(BTRIM(cache.beian_hao)) = UPPER(BTRIM(i.beian_hao))`

const FUND_INFO_SELECT = `
       i.beian_hao, i.product_name, i.manager,
       ${sqlResolvedStrategySelect("i")},
       i.inception_date::text AS inception_date,
       i.ret_1w::text, i.ret_1m::text, i.ret_3m::text, i.ret_6m::text, i.ret_1y::text,
       COALESCE(i.sharpe_1y, cache.sharpe_1y)::text AS sharpe_1y,
       COALESCE(i.calmar_1y, cache.calmar_1y)::text AS calmar_1y,
       i.latest_nav::text, i.latest_nav_date::text AS latest_nav_date`

function strategyLabel(fund: Pick<FundInfo, "strategy_l1" | "strategy_l2" | "strategy_l3">): string {
  return formatFundStrategyLabel(fund.strategy_l1, fund.strategy_l2, fund.strategy_l3)
}

async function fetchFundByName(subject: string): Promise<FundInfo | null> {
  const rows = await query<FundInfo>(
    `SELECT ${FUND_INFO_SELECT}
     FROM private_fund_info i
     ${sqlType6LatestStrategyJoin("i.beian_hao")}
     ${RISK_CACHE_JOIN}
     WHERE i.product_name ILIKE $1 OR i.beian_hao ILIKE $1 OR i.manager ILIKE $1
     ORDER BY i.product_name
     LIMIT 1`,
    [`%${subject}%`],
  )
  return rows[0] ?? null
}

async function fetchCandidatePool(target: FundInfo, limit = 80): Promise<FundInfo[]> {
  // Match resolved 团队分类, else 平台分类 — not the often-empty private_fund_info.strategy_l*.
  const resolved = sqlType6TableResolvedStrategy()
  const rows = await query<FundInfo>(
    `SELECT i.beian_hao, i.product_name, i.manager,
            same.strategy_l1, same.strategy_l2, same.strategy_l3,
            i.inception_date::text AS inception_date,
            i.ret_1w::text, i.ret_1m::text, i.ret_3m::text, i.ret_6m::text, i.ret_1y::text,
            COALESCE(i.sharpe_1y, cache.sharpe_1y)::text AS sharpe_1y,
            COALESCE(i.calmar_1y, cache.calmar_1y)::text AS calmar_1y,
            i.latest_nav::text, i.latest_nav_date::text AS latest_nav_date
     FROM private_fund_info i
     ${RISK_CACHE_JOIN}
     JOIN (
       SELECT register_number, strategy_l1, strategy_l2, strategy_l3
       FROM (
         SELECT DISTINCT ON (UPPER(BTRIM(register_number)))
           register_number,
           ${resolved.l1} AS strategy_l1,
           ${resolved.l2} AS strategy_l2,
           ${resolved.l3} AS strategy_l3
         FROM type6_ops_team_full
         ORDER BY UPPER(BTRIM(register_number)), updated_at DESC NULLS LAST, id DESC
       ) t
       WHERE ($2::text IS NOT NULL AND t.strategy_l1 = $2::text)
          OR ($3::text IS NOT NULL AND t.strategy_l2 = $3::text)
     ) same ON UPPER(BTRIM(same.register_number)) = UPPER(BTRIM(i.beian_hao))
     WHERE i.beian_hao <> $1::text
     ORDER BY
       CASE WHEN $3::text IS NOT NULL AND same.strategy_l2 = $3::text THEN 0 ELSE 1 END,
       i.latest_nav_date DESC NULLS LAST
     LIMIT $4`,
    [target.beian_hao, target.strategy_l1, target.strategy_l2, limit],
  )
  return rows
}

async function loadNavNameAliases(
  funds: Pick<FundInfo, "beian_hao" | "product_name">[],
): Promise<Map<string, { type6Name: string | null; shortName: string | null }>> {
  const out = new Map<string, { type6Name: string | null; shortName: string | null }>()
  const beianHaos = funds.map((f) => f.beian_hao).filter(Boolean)
  if (beianHaos.length === 0) return out
  const upper = beianHaos.map((b) => b.trim().toUpperCase())
  const [type6Rows, bflRows] = await Promise.all([
    query<{ register_number: string; fund_name: string | null }>(
      `SELECT DISTINCT ON (UPPER(BTRIM(register_number)))
         register_number,
         NULLIF(BTRIM(fund_name), '') AS fund_name
       FROM type6_ops_team_full
       WHERE UPPER(BTRIM(register_number)) = ANY($1::text[])
       ORDER BY UPPER(BTRIM(register_number)), updated_at DESC NULLS LAST, id DESC`,
      [upper],
    ).catch(() => [] as { register_number: string; fund_name: string | null }[]),
    query<{ beian_hao: string; product_name: string | null; short_name: string | null }>(
      `SELECT beian_hao,
              NULLIF(BTRIM(product_name), '') AS product_name,
              NULLIF(BTRIM(short_name), '') AS short_name
       FROM private_fund_info_bfl
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])`,
      [upper],
    ).catch(() => [] as { beian_hao: string; product_name: string | null; short_name: string | null }[]),
  ])
  for (const row of type6Rows) {
    const key = row.register_number.trim().toUpperCase()
    const prev = out.get(key) ?? { type6Name: null, shortName: null }
    out.set(key, { ...prev, type6Name: row.fund_name })
  }
  for (const row of bflRows) {
    const key = row.beian_hao.trim().toUpperCase()
    const prev = out.get(key) ?? { type6Name: null, shortName: null }
    out.set(key, {
      type6Name: prev.type6Name ?? row.product_name,
      shortName: row.short_name ?? prev.shortName,
    })
  }
  return out
}

function batchHistoryToPoints(
  history: Array<{ nav: number; nav_date: string; return_nav?: number }>,
): NavPoint[] {
  return history
    .map((p) => ({
      price_date: p.nav_date.slice(0, 10),
      nav: String(p.nav),
      cumulative_nav: p.return_nav != null ? String(p.return_nav) : String(p.nav),
    }))
    .sort((a, b) => a.price_date.localeCompare(b.price_date))
}

// Same merge as the product detail page (type6 + group + email + team), batched.
// Platform-only beian lookups miss funds whose NAV is stored under a short name
// (e.g. 正合弘毅1号 / SAWV62 shows 73 rows on the detail page).
async function fetchNavBatch(
  funds: Pick<FundInfo, "beian_hao" | "product_name">[],
  months = 36,
): Promise<Record<string, NavPoint[]>> {
  if (funds.length === 0) return {}
  const asOf = new Date().toISOString().slice(0, 10)
  const aliases = await loadNavNameAliases(funds)
  const identities: ProductNavIdentity[] = funds.map((f) => {
    const alias = aliases.get(f.beian_hao.trim().toUpperCase())
    const type6Name = alias?.type6Name?.trim() || null
    const shortName = alias?.shortName?.trim() || null
    return {
      beian_hao: f.beian_hao,
      product_name: f.product_name,
      short_name: (type6Name && type6Name !== f.product_name ? type6Name : null) || shortName,
    }
  })

  const out: Record<string, NavPoint[]> = {}
  try {
    const resolver = await BatchNavResolver.create(identities, asOf)
    const since = addDays(asOf, Math.max(NAV_HISTORY_LOOKBACK_DAYS, months * 31))
    for (let i = 0; i < funds.length; i++) {
      const points = batchHistoryToPoints(
        resolver.mergedHistoryForRiskMetrics(identities[i], since),
      )
      if (points.length > 0) out[funds[i].beian_hao] = points
    }
  } catch (err) {
    console.warn("[similar-fund] BatchNavResolver failed, falling back to detail series", err)
  }

  const missing = funds.filter((f) => !(out[f.beian_hao]?.length))
  if (missing.length === 0) return out

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  await Promise.all(
    missing.map(async (f) => {
      try {
        const names = await resolveFundNames(f.beian_hao, f.product_name)
        const series = await loadFundNavSeries(
          f.beian_hao,
          names.product_name,
          names.short_name ?? identities.find((id) => id.beian_hao === f.beian_hao)?.short_name ?? "",
          { from: cutoffStr, to: asOf },
        )
        if (series.length > 0) {
          out[f.beian_hao] = series.map((p) => ({
            price_date: p.price_date,
            nav: p.level,
            cumulative_nav: p.level,
          }))
        }
      } catch (err) {
        console.warn(`[similar-fund] detail NAV fallback failed for ${f.beian_hao}`, err)
      }
    }),
  )
  return out
}

// ── Similarity math ─────────────────────────────────────────────────────────────

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 5) return null
  const meanX = xs.reduce((s, v) => s + v, 0) / n
  const meanY = ys.reduce((s, v) => s + v, 0) / n
  let num = 0, denX = 0, denY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY
    num += dx * dy; denX += dx * dx; denY += dy * dy
  }
  const denom = Math.sqrt(denX * denY)
  return denom === 0 ? null : num / denom
}

// Extract weekly returns from NAV series aligned to common dates
function extractAlignedReturns(
  targetPoints: NavPoint[],
  candidatePoints: NavPoint[],
): { targetReturns: number[]; candidateReturns: number[] } {
  // Use cumulative_nav for returns, fall back to nav
  const toVal = (p: NavPoint) => parseFloat(p.cumulative_nav ?? p.nav)

  // Build date maps
  const tMap = new Map(targetPoints.map((p) => [p.price_date, toVal(p)]))
  const cMap = new Map(candidatePoints.map((p) => [p.price_date, toVal(p)]))

  // Find common dates
  const allDates = [...new Set([...tMap.keys(), ...cMap.keys()])].sort()

  // Sample at shared dates (interpolate nearest if needed — simplified: only exact matches)
  const sharedDates = allDates.filter((d) => tMap.has(d) && cMap.has(d))
  if (sharedDates.length < 5) return { targetReturns: [], candidateReturns: [] }

  const targetReturns: number[] = []
  const candidateReturns: number[] = []
  for (let i = 1; i < sharedDates.length; i++) {
    const prevT = tMap.get(sharedDates[i - 1])!
    const currT = tMap.get(sharedDates[i])!
    const prevC = cMap.get(sharedDates[i - 1])!
    const currC = cMap.get(sharedDates[i])!
    if (prevT > 0 && prevC > 0) {
      targetReturns.push(currT / prevT - 1)
      candidateReturns.push(currC / prevC - 1)
    }
  }
  return { targetReturns, candidateReturns }
}

// Compute a [0,1] metric similarity score from pre-computed indicators
function metricSimilarity(target: FundInfo, candidate: FundInfo): number {
  const fields: (keyof FundInfo)[] = ["ret_1m", "ret_3m", "ret_6m", "ret_1y", "sharpe_1y", "calmar_1y"]
  let sum = 0, count = 0
  for (const f of fields) {
    const tv = parseFloat(target[f] as string ?? "")
    const cv = parseFloat(candidate[f] as string ?? "")
    if (!isFinite(tv) || !isFinite(cv)) continue
    // Normalized difference: 1 - |tv-cv| / (|tv| + |cv| + ε)
    const diff = Math.abs(tv - cv)
    const mag = Math.abs(tv) + Math.abs(cv) + 1e-6
    sum += 1 - Math.min(diff / mag, 1)
    count++
  }
  return count > 0 ? sum / count : 0
}

function computeSimilarity(
  target: FundInfo,
  targetNav: NavPoint[],
  candidate: FundInfo,
  candidateNav: NavPoint[],
): SimilarityResult {
  const { targetReturns, candidateReturns } = extractAlignedReturns(targetNav, candidateNav)
  const correlation = pearsonCorrelation(targetReturns, candidateReturns)
  const metricScore = metricSimilarity(target, candidate)

  // Overlap in months
  const tDates = new Set(targetNav.map((p) => p.price_date.slice(0, 7)))
  const cDates = new Set(candidateNav.map((p) => p.price_date.slice(0, 7)))
  const overlapMonths = [...tDates].filter((d) => cDates.has(d)).length

  // Combined score: correlation dominates when we have enough data, else fall back to metrics
  let score: number
  if (correlation !== null && overlapMonths >= 3) {
    score = 0.65 * Math.max(0, correlation) + 0.35 * metricScore
  } else {
    score = metricScore
  }

  return { fund: candidate, score, correlation, metricScore, overlapMonths, navPoints: candidateNav.length, nav: candidateNav }
}

// ── Nav stats ───────────────────────────────────────────────────────────────────

function computeNavStats(navPoints: NavPoint[]): {
  totalReturn: string | null
  annReturn: string | null
  maxDrawdown: string | null
  sharpe: string | null
  calmar: string | null
  recordCount: number
  dateRange: string
} {
  const empty = { totalReturn: null, annReturn: null, maxDrawdown: null, sharpe: null, calmar: null, recordCount: navPoints.length, dateRange: "" }
  if (navPoints.length < 2) return empty
  const vals = navPoints.map((p) => parseFloat(p.cumulative_nav ?? p.nav))
  const dates = navPoints.map((p) => p.price_date)
  const first = vals[0]
  const last = vals[vals.length - 1]
  const dateRange = `${dates[0]} ~ ${dates[dates.length - 1]}`
  if (!isFinite(first) || first <= 0 || !isFinite(last)) {
    return { ...empty, dateRange }
  }
  const totalRet = ((last / first - 1) * 100)
  const days = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86_400_000
  const annRet = days > 0 ? (Math.pow(last / first, 365 / days) - 1) * 100 : null
  let peak = -Infinity
  let maxDd = 0
  const periodRets: number[] = []
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] > peak) peak = vals[i]
    const dd = peak > 0 ? (peak - vals[i]) / peak : 0
    if (dd > maxDd) maxDd = dd
    if (i > 0 && vals[i - 1] > 0) periodRets.push(vals[i] / vals[i - 1] - 1)
  }
  let sharpe: string | null = null
  if (annRet !== null && periodRets.length > 1 && days > 0) {
    const recPerYear = periodRets.length / (days / 365)
    const mean = periodRets.reduce((s, r) => s + r, 0) / periodRets.length
    const variance = periodRets.reduce((s, r) => s + (r - mean) ** 2, 0) / periodRets.length
    const annVol = Math.sqrt(variance) * Math.sqrt(recPerYear)
    if (annVol > 0) sharpe = ((annRet / 100) / annVol).toFixed(2)
  }
  const calmar = annRet !== null && maxDd > 0 ? ((annRet / 100) / maxDd).toFixed(2) : null
  return {
    totalReturn: totalRet.toFixed(2),
    annReturn: annRet?.toFixed(2) ?? null,
    maxDrawdown: maxDd > 0 ? (maxDd * 100).toFixed(2) : null,
    sharpe,
    calmar,
    recordCount: navPoints.length,
    dateRange,
  }
}

function overlayRiskFromNav(fund: FundInfo, nav: NavPoint[]): FundInfo {
  const stats = computeNavStats(nav)
  return {
    ...fund,
    sharpe_1y: fund.sharpe_1y ?? stats.sharpe,
    calmar_1y: fund.calmar_1y ?? stats.calmar,
  }
}

function parseStoredRatio(value: string | null | undefined): string | null {
  if (!value) return null
  const n = parseFloat(value)
  return isFinite(n) ? n.toFixed(2) : null
}

function formatNavRiskLine(stats: ReturnType<typeof computeNavStats>, fund: FundInfo): string {
  const dbSharpe = parseStoredRatio(fund.sharpe_1y)
  const dbCalmar = parseStoredRatio(fund.calmar_1y)
  const sharpe = dbSharpe ?? stats.sharpe
  const calmar = dbCalmar ?? stats.calmar
  const mdd = stats.maxDrawdown
  const source = dbSharpe || dbCalmar
    ? "数据库预计算（一年期）"
    : stats.sharpe || stats.calmar
      ? "净值回退计算（数据库一年期夏普/卡玛为空）"
      : mdd
        ? "净值回退计算（仅回撤）"
        : null

  if (sharpe || calmar || mdd) {
    return `风险收益指标 — 来源: ${source}
  夏普: ${sharpe ?? "N/A"}  卡玛: ${calmar ?? "N/A"}  最大回撤: ${mdd ? "-" + mdd + "%" : "N/A"}  累计: ${stats.totalReturn ? "+" + stats.totalReturn + "%" : "N/A"}  年化: ${stats.annReturn ? "+" + stats.annReturn + "%" : "N/A"}
  说明: 已给出夏普/卡玛时禁止写「缺夏普/卡玛」或「缺风险指标」。数据库一年期优先；仅当数据库为空时才使用净值回退。`
  }
  return `风险指标不足：数据库一年期夏普/卡玛为空，且净值仅 ${stats.recordCount} 条无法回退计算`
}

// ── SSE helpers ─────────────────────────────────────────────────────────────────

function encodeEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// ── Main handler ────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { subject?: string; kbPath?: string } = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const subject = String(body.subject ?? "").trim()
  if (!subject) return NextResponse.json({ error: "请提供分析对象" }, { status: 400 })
  const kbPath = body.kbPath?.trim() ?? ""

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        try { controller.enqueue(encodeEvent(data)) } catch { /* closed */ }
      }

      // ── Planning ──────────────────────────────────────────────────────────────
      try {
        emit({ type: "phase", phase: "planning", message: "正在制定相似度分析方案..." })
        const planModel = getChatModel(false)
        const planResp = await withTimeout(
          planModel.invoke([
            new SystemMessage(
              `你是私募基金研究员。用户希望为基金"${subject}"找出策略和风险收益特征最相似的同类产品。\n请简述分析思路：包括如何筛选候选池、用哪些维度量化相似性（净值相关性、绩效指标、策略分类等）、预期报告结构，控制在150字以内。`,
            ),
            new HumanMessage(`请为"${subject}"的相似基金匹配分析制定方案。`),
          ]),
          18_000,
          { content: "（规划超时，直接进入数据阶段）" },
          "planning",
        )
        const planText = typeof planResp.content === "string" ? planResp.content : JSON.stringify(planResp.content)
        emit({ type: "plan_text", content: planText })
        emit({ type: "plan_done" })
      } catch (err) {
        emit({ type: "plan_text", content: `规划出错：${(err as Error).message}` })
        emit({ type: "plan_done" })
      }

      // ── Step 1: Find target fund ──────────────────────────────────────────────
      let target: FundInfo | null = null
      emit({ type: "step_start", step: 1, title: "获取目标基金基本信息" })
      try {
        target = await withTimeout(fetchFundByName(subject), 8_000, null, "fetchTarget")
        emit({
          type: "step_done", step: 1,
          summary: target
            ? `已找到：${target.product_name}（${target.beian_hao}），策略：${strategyLabel(target)}`
            : `数据库中未找到"${subject}"，将基于名称搜索继续分析`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 1, summary: `搜索出错：${(err as Error).message}` })
      }

      // ── Step 2: Build candidate pool ─────────────────────────────────────────
      let candidates: FundInfo[] = []
      emit({ type: "step_start", step: 2, title: "构建同类基金候选池" })
      try {
        if (target) {
          candidates = await withTimeout(fetchCandidatePool(target, 80), 10_000, [], "fetchCandidates")
        }
        emit({
          type: "step_done", step: 2,
          summary: candidates.length > 0
            ? `找到 ${candidates.length} 只同策略候选基金（策略：${target ? strategyLabel(target) : "全部"}）`
            : "未找到同策略基金，将在全库中搜索近似产品",
        })
      } catch (err) {
        emit({ type: "step_done", step: 2, summary: `候选池构建出错：${(err as Error).message}` })
      }

      // Fallback: if no strategy match, get most active funds globally
      if (candidates.length === 0 && target) {
        try {
          const fallback = await query<FundInfo>(
            `SELECT ${FUND_INFO_SELECT}
             FROM private_fund_info i
             ${sqlType6LatestStrategyJoin("i.beian_hao")}
             ${RISK_CACHE_JOIN}
             WHERE i.beian_hao <> $1
             ORDER BY i.latest_nav_date DESC NULLS LAST LIMIT 50`,
            [target.beian_hao],
          )
          candidates = fallback
        } catch { /* ignore */ }
      }

      // ── Step 3: Fetch NAV + compute similarity ────────────────────────────────
      let topSimilar: SimilarityResult[] = []
      let targetNav: NavPoint[] = []
      emit({ type: "step_start", step: 3, title: "获取净值数据并计算相似度" })
      try {
        const allFunds = target ? [target, ...candidates] : candidates
        const navMap = await withTimeout(
          fetchNavBatch(allFunds.map((f) => ({ beian_hao: f.beian_hao, product_name: f.product_name }))),
          45_000,
          {} as Record<string, NavPoint[]>,
          "fetchNavBatch",
        )

        targetNav = target ? (navMap[target.beian_hao] ?? []) : []
        const scoredTarget = target ? overlayRiskFromNav(target, targetNav) : null

        // Score each candidate
        const scored: SimilarityResult[] = []
        for (const c of candidates) {
          const cNav = navMap[c.beian_hao] ?? []
          const candidateWithRisk = overlayRiskFromNav(c, cNav)
          const result = computeSimilarity(scoredTarget ?? candidateWithRisk, targetNav, candidateWithRisk, cNav)
          scored.push({ ...result, fund: c })
        }

        // Sort by score descending; require at least some nav or metric data
        topSimilar = scored
          .filter((r) => r.score > 0 || r.metricScore !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)

        const navCount = Object.values(navMap).reduce((s, v) => s + v.length, 0)
        emit({
          type: "step_done", step: 3,
          summary: `获取了 ${navCount} 条净值记录；从 ${candidates.length} 只候选基金中筛出 ${topSimilar.length} 只最相似基金`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 3, summary: `相似度计算出错：${(err as Error).message}` })
      }

      // ── Step 4: Knowledge base ────────────────────────────────────────────────
      let kbContext = ""
      emit({ type: "step_start", step: 4, title: "查询知识库补充信息" })
      try {
        const { askKnowledgeBaseQuestion } = await import("@/lib/server/knowledge-chat")
        const querySubjects = [subject, ...topSimilar.slice(0, 3).map((r) => r.fund.product_name)]
        const kbResults = await Promise.allSettled(
          querySubjects.map((s) =>
            withTimeout(
              askKnowledgeBaseQuestion({
                question: `关于"${s}"：请提取策略特点、历史业绩、风险控制方法和团队背景。`,
                folderPath: kbPath || null,
                useBm25: true,
                modelMode: "turbo",
                deepSearch: false,
              }),
              20_000,
              { answer: "", sources: [] as string[], indexedDocuments: 0, indexedChunks: 0, model: "" },
              `kb:${s}`,
            ),
          ),
        )
        const sections: string[] = []
        for (let i = 0; i < querySubjects.length; i++) {
          const r = kbResults[i]
          if (r.status === "fulfilled" && r.value.answer.trim().length > 30) {
            sections.push(`【${querySubjects[i]}】\n${r.value.answer.trim()}`)
          }
        }
        kbContext = sections.join("\n\n---\n\n")
        emit({
          type: "step_done", step: 4,
          summary: kbContext.length > 50 ? `知识库检索完成，覆盖 ${sections.length} 个研究对象` : "知识库中未找到相关内容",
        })
      } catch (err) {
        emit({ type: "step_done", step: 4, summary: `知识库查询出错：${(err as Error).message}` })
      }

      // ── Step 5: Generate report ───────────────────────────────────────────────
      emit({ type: "step_start", step: 5, title: "生成相似度分析报告" })
      try {
        // Build data summary
        const targetStats = computeNavStats(targetNav)
        const targetSection = target
          ? `=== 目标基金 ===
【${target.product_name}】(${target.beian_hao})
  管理人: ${target.manager}  成立: ${target.inception_date ?? "未知"}
  策略: ${strategyLabel(target)}
  最新净值: ${target.latest_nav ?? "N/A"} (${target.latest_nav_date ?? "N/A"})
  近1月/3月/6月/1年: ${target.ret_1m ?? "N/A"} / ${target.ret_3m ?? "N/A"} / ${target.ret_6m ?? "N/A"} / ${target.ret_1y ?? "N/A"}
  ${formatNavRiskLine(targetStats, target)}`
          : `=== 目标基金 ===\n注：数据库中未找到"${subject}"的精确记录`

        const similarSection = topSimilar.map((r, idx) => {
          const stats = computeNavStats(r.nav)
          const corrStr = r.correlation !== null ? r.correlation.toFixed(3) : "N/A（数据不足）"
          const metricStr = r.metricScore !== null ? (r.metricScore * 100).toFixed(1) + "%" : "N/A"
          return `=== #${idx + 1} 最相似基金（综合评分: ${(r.score * 100).toFixed(1)}）===
【${r.fund.product_name}】(${r.fund.beian_hao})
  管理人: ${r.fund.manager}  成立: ${r.fund.inception_date ?? "未知"}
  策略: ${strategyLabel(r.fund)}
  相关性（重叠${r.overlapMonths}个月）: ${corrStr}
  指标相似度: ${metricStr}
  净值记录数: ${r.navPoints}条${r.navPoints === 0 ? "（本次合并未取到序列，不得写成产品未披露净值）" : ""}
  近1月/3月/6月/1年: ${r.fund.ret_1m ?? "N/A"} / ${r.fund.ret_3m ?? "N/A"} / ${r.fund.ret_6m ?? "N/A"} / ${r.fund.ret_1y ?? "N/A"}
  ${formatNavRiskLine(stats, r.fund)}`
        }).join("\n\n")

        const kbSection = kbContext ? `\n=== 知识库补充信息 ===\n${kbContext}` : ""

        const userPrompt = `请基于以下数据，为"${subject}"生成相似基金分析报告：

${targetSection}

${similarSection}
${kbSection}

报告要求：
1. 对每只相似基金说明相似的具体原因（策略、绩效节奏、风险收益特征等）
2. 明确指出综合最相似的基金，并详细分析其相似性
3. 对比各基金的差异点，帮助投资者区分它们
4. 基于已有数据给出投资配置建议
5. 若某基金在某方面与目标基金形成互补而非相似，也请指出`

        const systemPrompt = `你是专业私募基金研究员，擅长基金相似性分析和投资策略研究。
请生成"${subject}"的相似基金分析报告，格式要求：
- Markdown格式，使用#/##/###标题层级
- 执行摘要（最相似基金结论、1-2句核心发现）
- 相似度排名总览表（维度：相关性/策略/业绩/风险收益可比性/数据完整性）
- 逐一分析各相似基金（相似点、差异点）
- 最相似基金深度剖析
- 投资建议（配置价值、替代/互补关系）
- 语言专业严谨，数据不足时标注而非编造
风险收益可比性规则（必须遵守）：
- 优先使用「数据库预计算（一年期）」的夏普/卡玛。
- 仅当数据库一年期字段为空时，才使用「净值回退计算」的夏普/卡玛/回撤。
- 只要已给出夏普或卡玛（无论来自数据库还是净值回退），禁止写「缺夏普/卡玛」或「缺风险指标」。
- 仅当数据库一年期夏普/卡玛均为空、且净值回退也无法计算时，才可标注风险指标缺失。
- 净值记录数来自本次合并拉取。禁止把 0 条写成「尚未披露历史净值」；产品详情页可能有完整序列，0 只表示本次未匹配到。有净值条数时必须用其计算相关性和数据完整性。`

        const reportModel = getChatModel(true)
        const reportStream = await reportModel.stream([
          new SystemMessage(systemPrompt),
          new HumanMessage(userPrompt),
        ])

        let reportLength = 0
        for await (const chunk of reportStream) {
          const delta = typeof chunk.content === "string" ? chunk.content : ""
          if (delta) { emit({ type: "report_text", delta }); reportLength += delta.length }
        }

        emit({ type: "step_done", step: 5, summary: `报告生成完成（约 ${reportLength} 字）` })
        emit({ type: "done" })
      } catch (err) {
        console.error("[similar-fund] report error:", err)
        emit({ type: "step_done", step: 5, summary: `报告生成失败：${(err as Error).message}` })
        emit({ type: "error", message: `报告生成失败：${(err as Error).message}` })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
