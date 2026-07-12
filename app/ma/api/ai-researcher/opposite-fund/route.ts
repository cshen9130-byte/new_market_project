import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

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
    new Promise<T>((resolve) => setTimeout(() => { console.warn(`[opposite-fund] ${label} timed out`); resolve(fallback) }, ms)),
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

interface OppositeResult {
  fund: FundInfo
  /** negative correlation score: how anti-correlated it is */
  score: number
  /** raw Pearson correlation (will be negative for top candidates) */
  correlation: number | null
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
     ORDER BY product_name LIMIT 1`,
    [`%${subject}%`],
  )
  return rows[0] ?? null
}

// For opposite funds we search broadly — different strategies are often where
// true anti-correlation lives (e.g. a long-short vs. a pure long strategy).
async function fetchBroadCandidatePool(target: FundInfo, limit = 100): Promise<FundInfo[]> {
  const rows = await query<FundInfo>(
    `SELECT beian_hao, product_name, manager, strategy_l1, strategy_l2,
            inception_date::text AS inception_date,
            ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
            sharpe_1y::text, calmar_1y::text,
            latest_nav::text, latest_nav_date::text AS latest_nav_date
     FROM private_fund_info
     WHERE beian_hao <> $1::text
       AND latest_nav_date IS NOT NULL
     ORDER BY latest_nav_date DESC NULLS LAST
     LIMIT $2`,
    [target.beian_hao, limit],
  )
  return rows
}

async function fetchNavBatch(
  funds: Pick<FundInfo, "beian_hao" | "product_name">[],
  months = 36,
): Promise<Record<string, NavPoint[]>> {
  if (funds.length === 0) return {}
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const beianHaos = funds.map((f) => f.beian_hao)

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

  const all = [...groupRows, ...hyRows, ...navRows]
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

// ── Correlation math ─────────────────────────────────────────────────────────────

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 6) return null
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

function extractAlignedReturns(
  targetPoints: NavPoint[],
  candidatePoints: NavPoint[],
): { targetReturns: number[]; candidateReturns: number[] } {
  const toVal = (p: NavPoint) => parseFloat(p.cumulative_nav ?? p.nav)
  const tMap = new Map(targetPoints.map((p) => [p.price_date, toVal(p)]))
  const cMap = new Map(candidatePoints.map((p) => [p.price_date, toVal(p)]))
  const sharedDates = [...tMap.keys()].filter((d) => cMap.has(d)).sort()
  if (sharedDates.length < 6) return { targetReturns: [], candidateReturns: [] }
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

/** Score how "opposite" a candidate is: higher = more anti-correlated */
function computeOppositeScore(
  targetNav: NavPoint[],
  candidate: FundInfo,
  candidateNav: NavPoint[],
): OppositeResult {
  const { targetReturns, candidateReturns } = extractAlignedReturns(targetNav, candidateNav)
  const correlation = pearsonCorrelation(targetReturns, candidateReturns)

  const tDates = new Set(targetNav.map((p) => p.price_date.slice(0, 7)))
  const cDates = new Set(candidateNav.map((p) => p.price_date.slice(0, 7)))
  const overlapMonths = [...tDates].filter((d) => cDates.has(d)).length

  // Score = how negative the correlation is: -1 correlation → score 1.0
  // Require at least 3 months overlap for a reliable reading.
  const score =
    correlation !== null && overlapMonths >= 3
      ? Math.max(0, -correlation)   // −1 → 1.0,  0 → 0.0,  +1 → 0.0
      : 0

  return { fund: candidate, score, correlation, overlapMonths, navPoints: candidateNav.length }
}

function computeNavStats(navPoints: NavPoint[]): {
  totalReturn: string | null; annReturn: string | null; maxDrawdown: string | null; sharpe: string | null
} {
  if (navPoints.length < 2) return { totalReturn: null, annReturn: null, maxDrawdown: null, sharpe: null }
  const vals = navPoints.map((p) => parseFloat(p.cumulative_nav ?? p.nav))
  const first = vals[0]; const last = vals[vals.length - 1]
  if (!isFinite(first) || first <= 0) return { totalReturn: null, annReturn: null, maxDrawdown: null, sharpe: null }
  const totalRet = (last / first - 1) * 100
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

// ── SSE helper ──────────────────────────────────────────────────────────────────

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
        emit({ type: "phase", phase: "planning", message: "正在制定对冲基金匹配方案..." })
        const planModel = getChatModel(false)
        const planResp = await withTimeout(
          planModel.invoke([
            new SystemMessage(
              `你是私募基金组合构建专家。用户希望为基金"${subject}"找出净值走势相反的对冲/对立产品，以实现组合分散或对冲目的。\n请简述方案：如何从全库中筛选候选基金、用什么指标量化"反向性"（负相关系数、涨跌互现频率等）、预期报告结构，控制在150字以内。`,
            ),
            new HumanMessage(`请为"${subject}"的相反基金匹配制定方案。`),
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
            : `数据库中未找到"${subject}"的精确记录`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 1, summary: `搜索出错：${(err as Error).message}` })
      }

      // ── Step 2: Build broad candidate pool ───────────────────────────────────
      let candidates: FundInfo[] = []
      emit({ type: "step_start", step: 2, title: "构建全库候选池（跨策略搜索）" })
      try {
        if (target) {
          candidates = await withTimeout(fetchBroadCandidatePool(target, 100), 10_000, [], "fetchCandidates")
        }
        emit({
          type: "step_done", step: 2,
          summary: `从全库筛选了 ${candidates.length} 只活跃基金作为候选（反向基金往往来自不同策略）`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 2, summary: `候选池构建出错：${(err as Error).message}` })
      }

      // ── Step 3: Fetch NAV + compute anti-correlation ──────────────────────────
      let topOpposite: OppositeResult[] = []
      let targetNav: NavPoint[] = []
      emit({ type: "step_start", step: 3, title: "计算净值负相关性" })
      try {
        const allFunds = target ? [target, ...candidates] : candidates
        const navMap = await withTimeout(
          fetchNavBatch(allFunds.map((f) => ({ beian_hao: f.beian_hao, product_name: f.product_name }))),
          30_000,
          {} as Record<string, NavPoint[]>,
          "fetchNavBatch",
        )

        targetNav = target ? (navMap[target.beian_hao] ?? []) : []

        const scored: OppositeResult[] = []
        for (const c of candidates) {
          const cNav = navMap[c.beian_hao] ?? []
          if (cNav.length < 6) continue   // skip funds with too few data points
          scored.push(computeOppositeScore(targetNav, c, cNav))
        }

        // Sort by score descending (most anti-correlated first)
        topOpposite = scored
          .filter((r) => r.correlation !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)

        const navCount = Object.values(navMap).reduce((s, v) => s + v.length, 0)
        const topCorr = topOpposite[0]?.correlation?.toFixed(3) ?? "N/A"
        emit({
          type: "step_done", step: 3,
          summary: `分析了 ${scored.filter(r => r.correlation !== null).length} 只有效基金；最强负相关系数: ${topCorr}，筛出 ${topOpposite.length} 只候选`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 3, summary: `负相关计算出错：${(err as Error).message}` })
      }

      // ── Step 4: Knowledge base ────────────────────────────────────────────────
      let kbContext = ""
      emit({ type: "step_start", step: 4, title: "查询知识库补充信息" })
      try {
        const { askKnowledgeBaseQuestion } = await import("@/lib/server/knowledge-chat")
        const querySubjects = [subject, ...topOpposite.slice(0, 3).map((r) => r.fund.product_name)]
        const kbResults = await Promise.allSettled(
          querySubjects.map((s) =>
            withTimeout(
              askKnowledgeBaseQuestion({
                question: `关于"${s}"：请提取策略特点、历史业绩、波动特征和市场敏感性。`,
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
      emit({ type: "step_start", step: 5, title: "生成对冲匹配分析报告" })
      try {
        const targetStats = computeNavStats(targetNav)
        const targetSection = target
          ? `=== 目标基金 ===
【${target.product_name}】(${target.beian_hao})
  管理人: ${target.manager}  成立: ${target.inception_date ?? "未知"}
  策略: ${[target.strategy_l1, target.strategy_l2].filter(Boolean).join(" > ") || "未分类"}
  最新净值: ${target.latest_nav ?? "N/A"} (${target.latest_nav_date ?? "N/A"})
  近1月/3月/6月/1年: ${target.ret_1m ?? "N/A"} / ${target.ret_3m ?? "N/A"} / ${target.ret_6m ?? "N/A"} / ${target.ret_1y ?? "N/A"}
  计算指标 — 累计收益: ${targetStats.totalReturn ? "+" + targetStats.totalReturn + "%" : "N/A"}  年化: ${targetStats.annReturn ? "+" + targetStats.annReturn + "%" : "N/A"}  最大回撤: ${targetStats.maxDrawdown ? "-" + targetStats.maxDrawdown + "%" : "N/A"}  夏普: ${targetStats.sharpe ?? "N/A"}`
          : `目标基金"${subject}"在数据库中未找到精确记录`

        const oppositeSection = topOpposite.map((r, idx) => {
          const corrStr = r.correlation !== null ? r.correlation.toFixed(3) : "N/A"
          const antiScore = (r.score * 100).toFixed(1)
          return `=== #${idx + 1} 最强负相关基金（反向评分: ${antiScore}/100）===
【${r.fund.product_name}】(${r.fund.beian_hao})
  管理人: ${r.fund.manager}  成立: ${r.fund.inception_date ?? "未知"}
  策略: ${[r.fund.strategy_l1, r.fund.strategy_l2].filter(Boolean).join(" > ") || "未分类"}
  Pearson相关系数（重叠${r.overlapMonths}个月）: ${corrStr}
  净值记录数: ${r.navPoints}条
  近1月/3月/6月/1年: ${r.fund.ret_1m ?? "N/A"} / ${r.fund.ret_3m ?? "N/A"} / ${r.fund.ret_6m ?? "N/A"} / ${r.fund.ret_1y ?? "N/A"}
  夏普(1年): ${r.fund.sharpe_1y ?? "N/A"}  卡玛(1年): ${r.fund.calmar_1y ?? "N/A"}`
        }).join("\n\n")

        const kbSection = kbContext ? `\n=== 知识库补充信息 ===\n${kbContext}` : ""

        const userPrompt = `请基于以下数据，为"${subject}"生成对冲匹配分析报告：

${targetSection}

${oppositeSection}
${kbSection}`

        const systemPrompt = `你是专业的私募基金组合构建与对冲策略研究员。
请为"${subject}"生成对冲基金匹配报告，Markdown格式，结构如下：
1. 执行摘要（最强对冲标的结论，1-2句核心发现）
2. 负相关排名总览表（维度：相关系数/策略类型/反向逻辑/适用场景）
3. 逐一分析各反向基金（为什么反向、在何种市场环境下互为对冲）
4. 最佳对冲标的深度分析（策略差异、驱动因素对比、历史表现的对立性）
5. 组合应用建议（如何配比、适合哪些风险偏好、注意事项）
6. 风险提示（负相关并非永久，市场极端情况下相关性可能逆转等）

要求：专业严谨，数据不足时标注；重点分析"为何反向"的策略逻辑，而非只列数字。`

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
        console.error("[opposite-fund] report error:", err)
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
