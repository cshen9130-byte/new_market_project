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

// ── Timeout helper ─────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.warn(`[ai-researcher] ${label} timed out after ${ms}ms, using fallback`)
        resolve(fallback)
      }, ms)
    }),
  ])
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

interface FundBasicInfo {
  beian_hao: string
  product_name: string
  manager: string
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  benchmark: string | null
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

interface ManagerInfo {
  registration_no: string
  manager_name: string
  registration_date: string | null
  aum: string | null
  product_count: number | null
}

async function fetchFundsBySubjects(subjects: string[]): Promise<FundBasicInfo[]> {
  if (subjects.length === 0) return []
  const conditions = subjects
    .map((_, i) => `(product_name ILIKE $${i + 1} OR beian_hao ILIKE $${i + 1} OR manager ILIKE $${i + 1})`)
    .join(" OR ")
  const params = subjects.map((s) => `%${s}%`)
  const rows = await query<FundBasicInfo>(
    `SELECT
       beian_hao, product_name, manager, strategy_l1, strategy_l2,
       inception_date::text AS inception_date, benchmark,
       ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
       sharpe_1y::text, calmar_1y::text,
       latest_nav::text, latest_nav_date::text AS latest_nav_date
     FROM private_fund_info
     WHERE ${conditions}
     ORDER BY product_name
     LIMIT 20`,
    params,
  )
  return rows
}

async function fetchNavHistoryRaw(beianHaos: string[], months = 24): Promise<Record<string, NavPoint[]>> {
  if (beianHaos.length === 0) return {}
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const rows = await query<{ beian_hao: string; price_date: string; nav: string; cumulative_nav: string | null }>(
    `SELECT beian_hao, price_date::text AS price_date, nav::text AS nav, cumulative_nav::text AS cumulative_nav
     FROM private_fund_nav
     WHERE beian_hao = ANY($1::text[])
       AND price_date >= $2::date
       AND nav IS NOT NULL AND nav::numeric > 0
     ORDER BY beian_hao, price_date ASC`,
    [beianHaos, cutoffStr],
  )
  const result: Record<string, NavPoint[]> = {}
  for (const row of rows) {
    if (!result[row.beian_hao]) result[row.beian_hao] = []
    result[row.beian_hao].push({ price_date: row.price_date, nav: row.nav, cumulative_nav: row.cumulative_nav })
  }
  return result
}

// Wraps the NAV fetch with a 12-second timeout so a slow/empty table scan
// never blocks the rest of the pipeline.
async function fetchNavHistory(beianHaos: string[]): Promise<{ navMap: Record<string, NavPoint[]>; timedOut: boolean }> {
  if (beianHaos.length === 0) return { navMap: {}, timedOut: false }
  let timedOut = false
  const navMap = await Promise.race([
    fetchNavHistoryRaw(beianHaos),
    new Promise<Record<string, NavPoint[]>>((resolve) =>
      setTimeout(() => {
        timedOut = true
        resolve({})
      }, 12_000),
    ),
  ])
  return { navMap, timedOut }
}

async function fetchManagerInfo(managerNames: string[]): Promise<ManagerInfo[]> {
  if (managerNames.length === 0) return []
  const conditions = managerNames.map((_, i) => `manager_name ILIKE $${i + 1}`).join(" OR ")
  const params = managerNames.map((m) => `%${m}%`)
  try {
    return await withTimeout(
      query<ManagerInfo>(
        `SELECT registration_no, manager_name,
                registration_date::text AS registration_date,
                aum::text AS aum,
                product_count
         FROM private_fund_managers
         WHERE ${conditions}
         LIMIT 10`,
        params,
      ),
      8_000,
      [],
      "fetchManagerInfo",
    )
  } catch {
    return []
  }
}

// ── KB query helper ────────────────────────────────────────────────────────────

interface KbResult {
  answer: string
  sources: string[]
}

// Query each subject individually – a single combined query dilutes the
// vector similarity and misses fund-specific documents. Per-subject queries
// mirror how the KB assistant is used manually (type the fund name → get hits).
async function queryKnowledgeBase(
  subjects: string[],
  kbPath: string | null,
  navMissing: boolean,
): Promise<KbResult> {
  const { askKnowledgeBaseQuestion } = await import("@/lib/server/knowledge-chat")

  const folderPath = kbPath || null // null = global search across all indexed docs

  // Build one focused question per subject, then run all in parallel
  const perSubjectQueries = subjects.map((subject) => {
    const q = navMissing
      ? `关于"${subject}"：请提取该基金/管理人的历史净值走势、累计收益率、最大回撤、夏普比率等业绩数据，以及策略特点、风险控制方法、投资团队背景。如有具体数字请完整列出。`
      : `关于"${subject}"：请从相关文档（路演材料、月报、尽调资料等）中提取该基金/管理人的策略特点、投资方法、历史业绩、团队背景和产品特色。`
    return withTimeout(
      askKnowledgeBaseQuestion({
        question: q,
        folderPath,
        useBm25: true,
        modelMode: "turbo",
        deepSearch: navMissing,
      }),
      25_000,
      { answer: "", sources: [] as string[], indexedDocuments: 0, indexedChunks: 0, model: "" },
      `kb-query:${subject}`,
    )
  })

  const results = await Promise.allSettled(perSubjectQueries)

  const sections: string[] = []
  const allSources: string[] = []

  for (let i = 0; i < subjects.length; i++) {
    const res = results[i]
    if (res.status === "rejected") continue
    const { answer, sources } = res.value
    if (answer && answer.trim().length > 30) {
      sections.push(`【${subjects[i]}】\n${answer.trim()}`)
    }
    if (sources) {
      for (const s of sources) {
        if (!allSources.includes(s)) allSources.push(s)
      }
    }
  }

  return {
    answer: sections.join("\n\n---\n\n"),
    sources: allSources,
  }
}

// ── SSE helpers ────────────────────────────────────────────────────────────────

function encodeEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// ── Report helpers ─────────────────────────────────────────────────────────────

function buildDataSummary(
  funds: FundBasicInfo[],
  navMap: Record<string, NavPoint[]>,
  navTimedOut: boolean,
  managers: ManagerInfo[],
): string {
  const lines: string[] = []

  lines.push("=== 基金基本信息 ===")
  for (const f of funds) {
    lines.push(`\n【${f.product_name}】(备案号: ${f.beian_hao})`)
    lines.push(`  管理人: ${f.manager}`)
    lines.push(`  策略: ${[f.strategy_l1, f.strategy_l2].filter(Boolean).join(" > ") || "未分类"}`)
    lines.push(`  成立日期: ${f.inception_date || "未知"}`)
    lines.push(`  基准: ${f.benchmark || "无"}`)
    lines.push(`  最新净值(系统): ${f.latest_nav || "N/A"} (${f.latest_nav_date || "N/A"})`)
    lines.push(`  系统绩效指标(预计算):`)
    lines.push(`    近1周: ${pct(f.ret_1w)}  近1月: ${pct(f.ret_1m)}  近3月: ${pct(f.ret_3m)}`)
    lines.push(`    近6月: ${pct(f.ret_6m)}  近1年: ${pct(f.ret_1y)}`)
    lines.push(`    夏普比(1年): ${num(f.sharpe_1y)}  卡玛比(1年): ${num(f.calmar_1y)}`)
  }

  if (managers.length > 0) {
    lines.push("\n=== 管理人信息 ===")
    for (const m of managers) {
      lines.push(`\n【${m.manager_name}】(登记号: ${m.registration_no})`)
      lines.push(`  登记日期: ${m.registration_date || "未知"}`)
      lines.push(`  管理规模: ${m.aum ? m.aum + "亿" : "未知"}`)
      lines.push(`  产品数量: ${m.product_count ?? "未知"}`)
    }
  }

  lines.push("\n=== 净值走势与计算指标（数据库）===")
  if (navTimedOut) {
    lines.push("⚠️ 净值数据库查询超时，未能获取历史净值序列。")
  }
  for (const f of funds) {
    const nav = navMap[f.beian_hao]
    if (!nav || nav.length === 0) {
      lines.push(`${f.product_name}: 数据库中无净值序列（可能未收录或备案号不匹配）`)
      continue
    }
    const stats = computeNavStats(nav)
    lines.push(`${f.product_name}: ${stats.recordCount}条记录 (${stats.dateRange})`)
    lines.push(`  区间累计收益: ${stats.totalReturn ? "+" + stats.totalReturn + "%" : "N/A"}`)
    lines.push(`  年化收益率(计算): ${stats.annReturn ? "+" + stats.annReturn + "%" : "N/A"}`)
    lines.push(`  今年以来收益(计算): ${stats.ytdReturn ? (parseFloat(stats.ytdReturn) >= 0 ? "+" : "") + stats.ytdReturn + "%" : "N/A"}`)
    lines.push(`  最大回撤(计算): ${stats.maxDrawdown ? "-" + stats.maxDrawdown + "%" : "N/A"}`)
    lines.push(`  夏普比率-成立以来(计算): ${stats.sharpe ?? "N/A"}`)
    lines.push(`  卡玛比率-成立以来(计算): ${stats.calmar ?? "N/A"}`)
    const recent = nav.slice(-12)
    const navStr = recent.map((p) => `${p.price_date.slice(0, 7)}: ${p.cumulative_nav || p.nav}`).join(", ")
    lines.push(`  近期累计净值: ${navStr}`)
  }

  return lines.join("\n")
}

// Values in private_fund_info are already stored in percentage form (e.g. 50.44, not 0.5044)
function pct(v: string | null): string {
  if (!v) return "N/A"
  const n = parseFloat(v)
  return isNaN(n) ? "N/A" : (n >= 0 ? "+" : "") + n.toFixed(2) + "%"
}

function num(v: string | null): string {
  if (!v) return "N/A"
  const n = parseFloat(v)
  return isNaN(n) ? "N/A" : n.toFixed(3)
}

interface NavStats {
  totalReturn: string | null     // percent
  annReturn: string | null       // percent
  ytdReturn: string | null       // percent
  maxDrawdown: string | null     // percent (positive = loss)
  sharpe: string | null
  calmar: string | null
  recordCount: number
  dateRange: string
}

function computeNavStats(navPoints: NavPoint[]): NavStats {
  if (navPoints.length < 2) {
    return { totalReturn: null, annReturn: null, ytdReturn: null, maxDrawdown: null, sharpe: null, calmar: null, recordCount: navPoints.length, dateRange: "" }
  }

  const vals = navPoints.map((p) => parseFloat(p.cumulative_nav ?? p.nav))
  const dates = navPoints.map((p) => p.price_date)

  const first = vals[0]
  const last = vals[vals.length - 1]
  if (!isFinite(first) || first <= 0 || !isFinite(last)) {
    return { totalReturn: null, annReturn: null, ytdReturn: null, maxDrawdown: null, sharpe: null, calmar: null, recordCount: navPoints.length, dateRange: `${dates[0]} ~ ${dates[dates.length - 1]}` }
  }

  const totalRet = (last / first - 1) * 100

  const days = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86_400_000
  const annRet = days > 0 ? (Math.pow(last / first, 365 / days) - 1) * 100 : null

  // YTD
  const thisYear = new Date().getFullYear().toString()
  const ytdBaseIdx = (() => {
    const lastBeforeYear = [...navPoints].reverse().findIndex((p) => p.price_date < `${thisYear}-01-01`)
    if (lastBeforeYear >= 0) return navPoints.length - 1 - lastBeforeYear
    return navPoints.findIndex((p) => p.price_date >= `${thisYear}-01-01`)
  })()
  const ytdBase = ytdBaseIdx >= 0 ? vals[ytdBaseIdx] : null
  const ytdRet = ytdBase && ytdBase > 0 ? (last / ytdBase - 1) * 100 : null

  // Max drawdown
  let peak = -Infinity
  let maxDd = 0
  const dailyRets: number[] = []
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]
    if (v > peak) peak = v
    const dd = peak > 0 ? (peak - v) / peak : 0
    if (dd > maxDd) maxDd = dd
    if (i > 0 && vals[i - 1] > 0) dailyRets.push(v / vals[i - 1] - 1)
  }

  // Sharpe (since inception, rf=0)
  let sharpe: string | null = null
  if (annRet !== null && dailyRets.length > 1 && days > 0) {
    const totalYears = days / 365
    const recPerYear = dailyRets.length / totalYears
    const mean = dailyRets.reduce((s, r) => s + r, 0) / dailyRets.length
    const variance = dailyRets.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyRets.length
    const annVol = Math.sqrt(variance) * Math.sqrt(recPerYear)
    if (annVol > 0) sharpe = ((annRet / 100) / annVol).toFixed(2)
  }

  // Calmar = annReturn / maxDrawdown
  const calmar = annRet !== null && maxDd > 0 ? ((annRet / 100) / maxDd).toFixed(2) : null

  return {
    totalReturn: totalRet.toFixed(2),
    annReturn: annRet !== null ? annRet.toFixed(2) : null,
    ytdReturn: ytdRet !== null ? ytdRet.toFixed(2) : null,
    maxDrawdown: maxDd > 0 ? (maxDd * 100).toFixed(2) : null,
    sharpe,
    calmar,
    recordCount: navPoints.length,
    dateRange: `${dates[0]} ~ ${dates[dates.length - 1]}`,
  }
}

function buildReportSystemPrompt(subjects: string[], hasKbNav: boolean): string {
  return `你是一位专业的私募基金研究员，擅长对同类策略的不同基金产品和管理人进行深度对比分析。

你将收到结构化数据，其中可能包含：
1. 基金基本信息（策略分类、成立日期、系统预计算绩效指标）
2. 净值历史序列（若数据库中有记录）
3. 管理人登记信息（如有）
${hasKbNav ? "4. 知识库提取的业绩/净值信息（来自路演材料、月报等文件）" : "4. 知识库补充信息（策略描述、团队背景等）"}

报告要求：
- 语言：中文，专业严谨，逻辑清晰
- 格式：Markdown（#/##/### 标题，- 列表，**粗体**强调关键数字）
- 内容：深度分析而非数据堆砌，给出有判断力的结论
- 数据缺失时：明确标注"数据不足"，不编造数字，但可基于可用信息进行定性分析
- 年化/年度指标（ret_1y、sharpe_1y 等）为 N/A 仅表示该基金成立不足一年，**不代表无净值数据**；请直接使用已有的 latest_nav、近1月/近3月/近6月收益和净值序列进行分析
- 若 latest_nav 字段有值，说明数据库中有最新净值记录，应明确引用；不得将"年化指标 N/A"误描述为"无任何净值披露"

建议报告结构（根据数据可用性灵活调整）：
1. 执行摘要（核心结论，2-3点关键发现）
2. 产品基本信息对比
3. 历史业绩与绩效指标对比
4. 风险特征对比（最大回撤、夏普比率、卡玛比率等）
5. 净值走势分析（有数据时画出关键趋势；无序列数据时基于已知信息分析）
6. 管理人/团队背景对比（如有信息）
7. 综合评估与投资建议

分析对象：${subjects.join("、")}`
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { subjects?: string[]; kbPath?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const subjects = Array.isArray(body.subjects)
    ? body.subjects.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
    : []

  if (subjects.length === 0) {
    return NextResponse.json({ error: "请提供至少一个分析对象" }, { status: 400 })
  }

  const kbPath = body.kbPath?.trim() ?? ""

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        try {
          controller.enqueue(encodeEvent(data))
        } catch {
          // controller already closed — ignore
        }
      }

      // Each step is wrapped independently so a failure in one never blocks the rest.

      // ── Planning ───────────────────────────────────────────────────────────
      try {
        emit({ type: "phase", phase: "planning", message: "正在规划分析方案..." })
        const planModel = getChatModel(false)
        const planResponse = await withTimeout(
          planModel.invoke([
            new SystemMessage(
              `你是一位专业私募基金研究员。用户希望对以下对象进行同策略对比分析：${subjects.join("、")}。\n请简要说明分析思路（分析角度、重点维度、预期结构），控制在200字以内，语言简练专业。`,
            ),
            new HumanMessage(`请为"${subjects.join("、")}"的对比分析生成分析规划。`),
          ]),
          20_000,
          { content: "（规划生成超时，直接进入数据获取阶段）" },
          "planning",
        )
        const planText =
          typeof planResponse.content === "string" ? planResponse.content : JSON.stringify(planResponse.content)
        emit({ type: "plan_text", content: planText })
        emit({ type: "plan_done" })
      } catch (err) {
        emit({ type: "plan_text", content: `规划阶段出错：${(err as Error).message}` })
        emit({ type: "plan_done" })
      }

      // ── Step 1: Search funds ────────────────────────────────────────────────
      let funds: FundBasicInfo[] = []
      emit({ type: "step_start", step: 1, title: "搜索并匹配基金/管理人信息" })
      try {
        funds = await withTimeout(fetchFundsBySubjects(subjects), 10_000, [], "fetchFunds")
        const foundNames = funds.map((f) => f.product_name)
        emit({
          type: "step_done",
          step: 1,
          summary:
            funds.length > 0
              ? `找到 ${funds.length} 只基金：${foundNames.slice(0, 3).join("、")}${funds.length > 3 ? " 等" : ""}`
              : "数据库中未找到匹配基金，将基于输入名称分析",
        })
      } catch (err) {
        emit({ type: "step_done", step: 1, summary: `搜索出错：${(err as Error).message}` })
      }

      // ── Step 2: NAV history ─────────────────────────────────────────────────
      let navMap: Record<string, NavPoint[]> = {}
      let navTimedOut = false
      let navMissing = false
      emit({ type: "step_start", step: 2, title: "获取净值历史数据" })
      try {
        const beianHaos = funds.map((f) => f.beian_hao)
        const result = await fetchNavHistory(beianHaos)
        navMap = result.navMap
        navTimedOut = result.timedOut
        const totalPoints = Object.values(navMap).reduce((s, v) => s + v.length, 0)
        navMissing = totalPoints === 0
        emit({
          type: "step_done",
          step: 2,
          summary: navTimedOut
            ? "⚠️ 查询超时，数据库净值序列未能获取（将从知识库补充）"
            : navMissing
              ? "数据库中暂无净值序列，将尝试从知识库路演材料中提取"
              : `获取了 ${totalPoints} 条净值记录（近24个月）`,
        })
      } catch (err) {
        navMissing = true
        emit({ type: "step_done", step: 2, summary: `获取净值出错：${(err as Error).message}，将从知识库补充` })
      }

      // ── Step 3: Manager info ────────────────────────────────────────────────
      let managers: ManagerInfo[] = []
      emit({ type: "step_start", step: 3, title: "获取管理人背景信息" })
      try {
        const managerNames = [...new Set(funds.map((f) => f.manager).filter(Boolean))]
        managers = await fetchManagerInfo(managerNames)
        emit({
          type: "step_done",
          step: 3,
          summary: managers.length > 0 ? `获取了 ${managers.length} 家管理人信息` : "未找到管理人详细信息",
        })
      } catch (err) {
        emit({ type: "step_done", step: 3, summary: `管理人查询出错：${(err as Error).message}` })
      }

      // ── Step 4: Knowledge base ──────────────────────────────────────────────
      // Always query KB – when kbPath is given, scope to that folder;
      // otherwise search all indexed documents globally.
      let kbContext = ""
      let hasKbNav = false
      emit({ type: "step_start", step: 4, title: "查询知识库相关文档" })
      try {
        const kbResult = await queryKnowledgeBase(
          subjects,
          kbPath || null,
          navMissing || navTimedOut,
        )
        kbContext = kbResult.answer ?? ""
        hasKbNav = (navMissing || navTimedOut) && /净值|累计净值|收益率|回撤|夏普|单位净值/.test(kbContext)
        const scope = kbPath ? `路径: ${kbPath}` : "全库检索"
        emit({
          type: "step_done",
          step: 4,
          summary:
            kbContext && kbContext.length > 50
              ? `检索完成（${scope}，${kbResult.sources.length} 个来源文件${hasKbNav ? "，已找到业绩/净值数据" : ""}）`
              : `知识库中未找到相关内容（${scope}）`,
        })
      } catch (err) {
        emit({
          type: "step_done",
          step: 4,
          summary: `知识库查询出错：${(err as Error).message}`,
        })
      }

      // ── Step 5: Generate report ─────────────────────────────────────────────
      emit({ type: "step_start", step: 5, title: "生成对比分析报告" })
      try {
        const dataSummary = buildDataSummary(funds, navMap, navTimedOut, managers)
        const kbSection = kbContext
          ? `\n=== 知识库提取信息（路演/月报/研究文件）===\n${kbContext}\n`
          : ""
        const userPrompt = [
          `请基于以下数据，生成"${subjects.join("、")}"的专业对比分析报告。`,
          "",
          dataSummary,
          kbSection,
          navMissing && !kbContext
            ? "注意：本次净值序列数据不足，请重点利用系统预计算的绩效指标（ret_1y、sharpe_1y 等）进行绩效比较，并在报告中说明数据局限性。"
            : "",
        ]
          .filter(Boolean)
          .join("\n")

        const reportModel = getChatModel(true)
        const reportStream = await reportModel.stream([
          new SystemMessage(buildReportSystemPrompt(subjects, hasKbNav)),
          new HumanMessage(userPrompt),
        ])

        let reportLength = 0
        for await (const chunk of reportStream) {
          const delta = typeof chunk.content === "string" ? chunk.content : ""
          if (delta) {
            emit({ type: "report_text", delta })
            reportLength += delta.length
          }
        }

        emit({ type: "step_done", step: 5, summary: `报告生成完成（约 ${reportLength} 字）` })
        emit({ type: "done" })
      } catch (err) {
        console.error("[ai-researcher/compare-analysis] report generation error:", err)
        emit({ type: "step_done", step: 5, summary: `报告生成失败：${(err as Error).message}` })
        emit({ type: "error", message: `报告生成失败：${(err as Error).message}` })
      } finally {
        try {
          controller.close()
        } catch {
          // already closed
        }
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
