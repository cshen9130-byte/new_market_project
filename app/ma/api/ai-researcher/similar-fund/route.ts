import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"

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
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function fetchFundByName(subject: string): Promise<FundInfo | null> {
  const rows = await query<FundInfo>(
    `SELECT beian_hao, product_name, manager, strategy_l1, strategy_l2,
            inception_date::text AS inception_date,
            ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
            sharpe_1y::text, calmar_1y::text,
            latest_nav::text, latest_nav_date::text AS latest_nav_date
     FROM private_fund_info
     WHERE product_name ILIKE $1 OR beian_hao ILIKE $1 OR manager ILIKE $1
     ORDER BY product_name
     LIMIT 1`,
    [`%${subject}%`],
  )
  return rows[0] ?? null
}

async function fetchCandidatePool(target: FundInfo, limit = 80): Promise<FundInfo[]> {
  // Same strategy_l1 (or strategy_l2 if available), excluding target
  const rows = await query<FundInfo>(
    `SELECT beian_hao, product_name, manager, strategy_l1, strategy_l2,
            inception_date::text AS inception_date,
            ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
            sharpe_1y::text, calmar_1y::text,
            latest_nav::text, latest_nav_date::text AS latest_nav_date
     FROM private_fund_info
     WHERE beian_hao <> $1
       AND (
         ($2 IS NOT NULL AND strategy_l1 = $2)
         OR ($3 IS NOT NULL AND strategy_l2 = $3)
       )
     ORDER BY
       CASE WHEN strategy_l2 = $3 AND $3 IS NOT NULL THEN 0 ELSE 1 END,
       latest_nav_date DESC NULLS LAST
     LIMIT $4`,
    [target.beian_hao, target.strategy_l1, target.strategy_l2, limit],
  )
  return rows
}

// Fetch NAV for many funds at once using the multi-table approach.
// Returns a map: beian_hao → sorted NavPoint[]
async function fetchNavBatch(
  funds: Pick<FundInfo, "beian_hao" | "product_name">[],
  months = 36,
): Promise<Record<string, NavPoint[]>> {
  if (funds.length === 0) return {}
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  // Batch: fetch all beian_haos from each table in one query per table,
  // then merge in JS. This is much faster than one query per fund.
  const beianHaos = funds.map((f) => f.beian_hao)
  const productNames = funds.map((f) => f.product_name).filter(Boolean)

  const [groupRows, hyRows, navRows] = await Promise.all([
    query<{ beian_hao: string; price_date: string; nav: string; cumulative_nav: string | null }>(
      `SELECT beian_hao, price_date::text, nav::text, cumulative_nav::text
       FROM private_fund_nav_group
       WHERE beian_hao = ANY($1::text[]) AND price_date >= $2::date AND nav IS NOT NULL
       ORDER BY beian_hao, price_date ASC`,
      [beianHaos, cutoffStr],
    ),
    query<{ beian_hao: string; price_date: string; nav: string; cumulative_nav: string | null }>(
      `SELECT beian_hao, price_date::text, nav::text, cumulative_nav::text
       FROM private_fund_nav_group_hy
       WHERE beian_hao = ANY($1::text[]) AND price_date >= $2::date AND nav IS NOT NULL
       ORDER BY beian_hao, price_date ASC`,
      [beianHaos, cutoffStr],
    ),
    query<{ beian_hao: string; price_date: string; nav: string; cumulative_nav: string | null }>(
      `SELECT beian_hao, price_date::text, nav::text, cumulative_nav::text
       FROM private_fund_nav
       WHERE beian_hao = ANY($1::text[]) AND price_date >= $2::date AND nav IS NOT NULL
       ORDER BY beian_hao, price_date ASC`,
      [beianHaos, cutoffStr],
    ),
  ])

  // Product-name fallback for funds not found by beian_hao
  const foundByBeianHao = new Set([...groupRows, ...hyRows, ...navRows].map((r) => r.beian_hao))
  const missingFunds = funds.filter((f) => !foundByBeianHao.has(f.beian_hao) && f.product_name)

  let nameRows: typeof groupRows = []
  if (missingFunds.length > 0) {
    const names = missingFunds.map((f) => f.product_name)
    nameRows = await query<{ beian_hao: string; price_date: string; nav: string; cumulative_nav: string | null }>(
      `SELECT beian_hao, price_date::text, nav::text, cumulative_nav::text
       FROM private_fund_nav_group
       WHERE product_name = ANY($1::text[]) AND price_date >= $2::date AND nav IS NOT NULL
       ORDER BY beian_hao, price_date ASC`,
      [names, cutoffStr],
    ).catch(() => [] as typeof groupRows)
    // Remap name rows back to the correct beian_hao
    for (const r of nameRows) {
      const f = missingFunds.find((m) => m.product_name === r.beian_hao) ?? missingFunds[0]
      if (f) r.beian_hao = f.beian_hao
    }
  }

  // Merge: group table takes priority, then hy, then nav
  const all = [...groupRows, ...hyRows, ...navRows, ...nameRows]
  const result: Record<string, Map<string, NavPoint>> = {}
  for (const r of all) {
    if (!result[r.beian_hao]) result[r.beian_hao] = new Map()
    if (!result[r.beian_hao].has(r.price_date)) {
      result[r.beian_hao].set(r.price_date, { price_date: r.price_date, nav: r.nav, cumulative_nav: r.cumulative_nav })
    }
  }
  const out: Record<string, NavPoint[]> = {}
  for (const [bh, dateMap] of Object.entries(result)) {
    out[bh] = [...dateMap.values()].sort((a, b) => a.price_date.localeCompare(b.price_date))
  }
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

  return { fund: candidate, score, correlation, metricScore, overlapMonths, navPoints: candidateNav.length }
}

// ── Nav stats ───────────────────────────────────────────────────────────────────

function computeNavStats(navPoints: NavPoint[]): {
  totalReturn: string | null; annReturn: string | null; maxDrawdown: string | null; sharpe: string | null
} {
  if (navPoints.length < 2) return { totalReturn: null, annReturn: null, maxDrawdown: null, sharpe: null }
  const vals = navPoints.map((p) => parseFloat(p.cumulative_nav ?? p.nav))
  const first = vals[0]; const last = vals[vals.length - 1]
  if (!isFinite(first) || first <= 0) return { totalReturn: null, annReturn: null, maxDrawdown: null, sharpe: null }
  const totalRet = ((last / first - 1) * 100)
  const days = (new Date(navPoints[navPoints.length - 1].price_date).getTime() - new Date(navPoints[0].price_date).getTime()) / 86_400_000
  const annRet = days > 0 ? (Math.pow(last / first, 365 / days) - 1) * 100 : null
  let peak = -Infinity; let maxDd = 0; const dailyRets: number[] = []
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] > peak) peak = vals[i]
    const dd = peak > 0 ? (peak - vals[i]) / peak : 0
    if (dd > maxDd) maxDd = dd
    if (i > 0 && vals[i - 1] > 0) dailyRets.push(vals[i] / vals[i - 1] - 1)
  }
  let sharpe: string | null = null
  if (annRet !== null && dailyRets.length > 1 && days > 0) {
    const recPerYear = dailyRets.length / (days / 365)
    const mean = dailyRets.reduce((s, r) => s + r, 0) / dailyRets.length
    const variance = dailyRets.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyRets.length
    const annVol = Math.sqrt(variance) * Math.sqrt(recPerYear)
    if (annVol > 0) sharpe = ((annRet / 100) / annVol).toFixed(2)
  }
  return { totalReturn: totalRet.toFixed(2), annReturn: annRet?.toFixed(2) ?? null, maxDrawdown: maxDd > 0 ? (maxDd * 100).toFixed(2) : null, sharpe }
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
            ? `已找到：${target.product_name}（${target.beian_hao}），策略：${[target.strategy_l1, target.strategy_l2].filter(Boolean).join(" > ") || "未分类"}`
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
            ? `找到 ${candidates.length} 只同策略候选基金（策略：${target?.strategy_l1 ?? "全部"}${target?.strategy_l2 ? " > " + target.strategy_l2 : ""}）`
            : "未找到同策略基金，将在全库中搜索近似产品",
        })
      } catch (err) {
        emit({ type: "step_done", step: 2, summary: `候选池构建出错：${(err as Error).message}` })
      }

      // Fallback: if no strategy match, get most active funds globally
      if (candidates.length === 0 && target) {
        try {
          const fallback = await query<FundInfo>(
            `SELECT beian_hao, product_name, manager, strategy_l1, strategy_l2,
                    inception_date::text, ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
                    sharpe_1y::text, calmar_1y::text, latest_nav::text, latest_nav_date::text
             FROM private_fund_info WHERE beian_hao <> $1
             ORDER BY latest_nav_date DESC NULLS LAST LIMIT 50`,
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
          25_000,
          {} as Record<string, NavPoint[]>,
          "fetchNavBatch",
        )

        targetNav = target ? (navMap[target.beian_hao] ?? []) : []

        // Score each candidate
        const scored: SimilarityResult[] = []
        for (const c of candidates) {
          const cNav = navMap[c.beian_hao] ?? []
          const result = computeSimilarity(target ?? c, targetNav, c, cNav)
          scored.push(result)
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
  策略: ${[target.strategy_l1, target.strategy_l2].filter(Boolean).join(" > ") || "未分类"}
  最新净值: ${target.latest_nav ?? "N/A"} (${target.latest_nav_date ?? "N/A"})
  近1月/3月/6月/1年: ${target.ret_1m ?? "N/A"} / ${target.ret_3m ?? "N/A"} / ${target.ret_6m ?? "N/A"} / ${target.ret_1y ?? "N/A"}
  数据库计算 — 累计收益: ${targetStats.totalReturn ? "+" + targetStats.totalReturn + "%" : "N/A"}  年化: ${targetStats.annReturn ? "+" + targetStats.annReturn + "%" : "N/A"}  最大回撤: ${targetStats.maxDrawdown ? "-" + targetStats.maxDrawdown + "%" : "N/A"}  夏普: ${targetStats.sharpe ?? "N/A"}`
          : `=== 目标基金 ===\n注：数据库中未找到"${subject}"的精确记录`

        const similarSection = topSimilar.map((r, idx) => {
          const stats = computeNavStats(r.navPoints > 0 ? [] : []) // stats computed earlier
          const corrStr = r.correlation !== null ? r.correlation.toFixed(3) : "N/A（数据不足）"
          const metricStr = r.metricScore !== null ? (r.metricScore * 100).toFixed(1) + "%" : "N/A"
          return `=== #${idx + 1} 最相似基金（综合评分: ${(r.score * 100).toFixed(1)}）===
【${r.fund.product_name}】(${r.fund.beian_hao})
  管理人: ${r.fund.manager}  成立: ${r.fund.inception_date ?? "未知"}
  策略: ${[r.fund.strategy_l1, r.fund.strategy_l2].filter(Boolean).join(" > ") || "未分类"}
  相关性（重叠${r.overlapMonths}个月）: ${corrStr}
  指标相似度: ${metricStr}
  净值记录数: ${r.navPoints}条
  近1月/3月/6月/1年: ${r.fund.ret_1m ?? "N/A"} / ${r.fund.ret_3m ?? "N/A"} / ${r.fund.ret_6m ?? "N/A"} / ${r.fund.ret_1y ?? "N/A"}
  夏普(1年): ${r.fund.sharpe_1y ?? "N/A"}  卡玛(1年): ${r.fund.calmar_1y ?? "N/A"}`
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
- 相似度排名总览表（维度：相关性/策略/业绩/风险）
- 逐一分析各相似基金（相似点、差异点）
- 最相似基金深度剖析
- 投资建议（配置价值、替代/互补关系）
- 语言专业严谨，数据不足时标注而非编造`

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
