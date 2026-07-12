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
  acc_nav: string | null
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
  const rows = await query<{ beian_hao: string; price_date: string; nav: string; acc_nav: string | null }>(
    `SELECT beian_hao, price_date::text AS price_date, nav::text AS nav, acc_nav::text AS acc_nav
     FROM private_fund_nav
     WHERE beian_hao = ANY($1::text[])
       AND price_date >= $2::date
       AND nav IS NOT NULL AND nav > 0
     ORDER BY beian_hao, price_date ASC`,
    [beianHaos, cutoffStr],
  )
  const result: Record<string, NavPoint[]> = {}
  for (const row of rows) {
    if (!result[row.beian_hao]) result[row.beian_hao] = []
    result[row.beian_hao].push({ price_date: row.price_date, nav: row.nav, acc_nav: row.acc_nav })
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
  note?: string
}

async function queryKnowledgeBase(
  subjects: string[],
  kbPath: string,
  navMissing: boolean,
): Promise<KbResult> {
  const { askKnowledgeBaseQuestion } = await import("@/lib/server/knowledge-chat")

  // When NAV data is absent from DB, ask specifically about performance/NAV data
  // that may exist in roadshow materials, monthly reports, or research documents.
  const question = navMissing
    ? `请从相关文件（路演材料、月报、尽调报告等）中提取以下基金的净值走势、历史业绩、收益数据和风险指标：${subjects.join("、")}。
如果找到净值数据请详细列出，同时提取策略特点、风险控制方法、团队背景等信息。`
    : `关于${subjects.join("、")}的策略特点、投资方法、风险控制、团队背景有哪些信息？请从相关文件中提取关键信息。`

  const kbResult = await withTimeout(
    askKnowledgeBaseQuestion({
      question,
      folderPath: kbPath,
      useBm25: true,
      modelMode: "turbo",
      deepSearch: navMissing, // use deeper search when hunting for NAV data
    }),
    30_000,
    { answer: "", sources: [], indexedDocuments: 0, indexedChunks: 0, model: "" },
    "queryKnowledgeBase",
  )

  return {
    answer: kbResult.answer,
    sources: kbResult.sources ?? [],
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

  lines.push("\n=== 净值走势（数据库）===")
  if (navTimedOut) {
    lines.push("⚠️ 净值数据库查询超时，未能获取历史净值序列。")
  }
  for (const f of funds) {
    const nav = navMap[f.beian_hao]
    if (!nav || nav.length === 0) {
      lines.push(`${f.product_name}: 数据库中无净值序列（可能未收录或备案号不匹配）`)
      continue
    }
    const first = nav[0]
    const last = nav[nav.length - 1]
    const totalReturn =
      last.acc_nav && first.acc_nav
        ? (((parseFloat(last.acc_nav) - parseFloat(first.acc_nav)) / parseFloat(first.acc_nav)) * 100).toFixed(2)
        : null
    lines.push(
      `${f.product_name}: ${nav.length}条记录 (${first.price_date} ~ ${last.price_date}), 区间累计收益: ${totalReturn ? totalReturn + "%" : "N/A"}`,
    )
    const recent = nav.slice(-12)
    const navStr = recent.map((p) => `${p.price_date.slice(0, 7)}: ${p.acc_nav || p.nav}`).join(", ")
    lines.push(`  近期净值: ${navStr}`)
  }

  return lines.join("\n")
}

function pct(v: string | null): string {
  if (!v) return "N/A"
  const n = parseFloat(v)
  return isNaN(n) ? "N/A" : (n * 100).toFixed(2) + "%"
}

function num(v: string | null): string {
  if (!v) return "N/A"
  const n = parseFloat(v)
  return isNaN(n) ? "N/A" : n.toFixed(3)
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
- 净值数据不足时：利用系统预计算的绩效指标（如有）和知识库中的业绩描述进行分析

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
      let kbContext = ""
      let hasKbNav = false
      emit({ type: "step_start", step: 4, title: "查询知识库相关文档" })
      if (kbPath) {
        try {
          const kbResult = await queryKnowledgeBase(subjects, kbPath, navMissing || navTimedOut)
          kbContext = kbResult.answer
          // Heuristic: if KB answer contains numbers that look like NAV values, flag it
          hasKbNav = navMissing && /净值|累计|收益率|回撤|夏普/.test(kbContext)
          emit({
            type: "step_done",
            step: 4,
            summary:
              kbResult.answer && kbResult.answer.length > 50
                ? `检索完成（${kbResult.sources.length} 个来源文件${hasKbNav ? "，发现业绩/净值信息" : ""}）`
                : "知识库中未找到相关内容",
          })
        } catch (err) {
          emit({ type: "step_done", step: 4, summary: `知识库查询出错：${(err as Error).message}` })
        }
      } else {
        const hint =
          navMissing || navTimedOut
            ? "⚠️ 未指定知识库路径，且数据库净值数据不足——如有路演材料请在设置中填写知识库路径以补充数据"
            : "未指定知识库路径，跳过（可在任务设置中填写路径以补充材料信息）"
        emit({ type: "step_done", step: 4, summary: hint })
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
