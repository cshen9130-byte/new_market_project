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
  ret_ytd: string | null
  ret_since_inception: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  max_drawdown: string | null
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
  key_person: string | null
  investment_style: string | null
}

async function fetchFundsBySubjects(subjects: string[]): Promise<FundBasicInfo[]> {
  if (subjects.length === 0) return []

  const conditions = subjects.map((_, i) => `(product_name ILIKE $${i + 1} OR beian_hao ILIKE $${i + 1} OR manager ILIKE $${i + 1})`).join(" OR ")
  const params = subjects.map((s) => `%${s}%`)

  const rows = await query<FundBasicInfo>(
    `SELECT
       beian_hao, product_name, manager, strategy_l1, strategy_l2,
       inception_date::text AS inception_date, benchmark,
       ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
       NULL::text AS ret_ytd, NULL::text AS ret_since_inception,
       sharpe_1y::text, calmar_1y::text,
       NULL::text AS max_drawdown,
       latest_nav::text, latest_nav_date::text AS latest_nav_date
     FROM private_fund_info
     WHERE ${conditions}
     ORDER BY product_name
     LIMIT 20`,
    params,
  )
  return rows
}

async function fetchNavHistory(beianHaos: string[], months = 24): Promise<Record<string, NavPoint[]>> {
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

async function fetchManagerInfo(managerNames: string[]): Promise<ManagerInfo[]> {
  if (managerNames.length === 0) return []
  const conditions = managerNames.map((_, i) => `manager_name ILIKE $${i + 1}`).join(" OR ")
  const params = managerNames.map((m) => `%${m}%`)

  try {
    const rows = await query<ManagerInfo>(
      `SELECT registration_no, manager_name,
              registration_date::text AS registration_date,
              aum::text AS aum,
              product_count,
              NULL::text AS key_person,
              NULL::text AS investment_style
       FROM private_fund_managers
       WHERE ${conditions}
       LIMIT 10`,
      params,
    )
    return rows
  } catch {
    return []
  }
}

// ── SSE helpers ────────────────────────────────────────────────────────────────

function encodeEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// ── Report generation ──────────────────────────────────────────────────────────

function buildDataSummary(funds: FundBasicInfo[], navMap: Record<string, NavPoint[]>, managers: ManagerInfo[]): string {
  const lines: string[] = []

  lines.push("=== 基金基本信息 ===")
  for (const f of funds) {
    lines.push(`\n【${f.product_name}】(备案号: ${f.beian_hao})`)
    lines.push(`  管理人: ${f.manager}`)
    lines.push(`  策略: ${[f.strategy_l1, f.strategy_l2].filter(Boolean).join(" > ") || "未分类"}`)
    lines.push(`  成立日期: ${f.inception_date || "未知"}`)
    lines.push(`  基准: ${f.benchmark || "无"}`)
    lines.push(`  最新净值: ${f.latest_nav || "N/A"} (${f.latest_nav_date || "N/A"})`)
    lines.push(`  绩效指标:`)
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

  lines.push("\n=== 净值走势摘要 ===")
  for (const f of funds) {
    const nav = navMap[f.beian_hao]
    if (!nav || nav.length === 0) {
      lines.push(`${f.product_name}: 无净值数据`)
      continue
    }
    const first = nav[0]
    const last = nav[nav.length - 1]
    const totalReturn = last.acc_nav && first.acc_nav
      ? (((parseFloat(last.acc_nav) - parseFloat(first.acc_nav)) / parseFloat(first.acc_nav)) * 100).toFixed(2)
      : null
    lines.push(`${f.product_name}: ${nav.length}条记录 (${first.price_date} ~ ${last.price_date}), 区间累计收益: ${totalReturn ? totalReturn + "%" : "N/A"}`)

    // Monthly nav sample (last 12 months for context)
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

function buildReportSystemPrompt(subjects: string[]): string {
  return `你是一位专业的私募基金研究员，擅长对同类策略的不同基金产品和管理人进行深度对比分析。

你将收到以下结构化数据：
1. 多只基金的基本信息（策略、成立日期、绩效指标等）
2. 近期净值走势数据
3. 管理人背景信息（如有）

你的任务：根据上述数据，生成一份专业、深度的对比分析报告。

报告要求：
- 语言：中文，专业严谨，逻辑清晰
- 格式：使用 Markdown 格式（标题用 #/##/###，列表用 -，重要数字用 **粗体**）
- 内容深度：不要只是复述数据，要进行分析、比较、解读，给出有价值的判断
- 报告结构请根据实际数据灵活调整，但一般应包含：
  1. 执行摘要（核心结论，2-3点关键发现）
  2. 产品概览对比（基本信息对比表格或结构化描述）
  3. 绩效表现对比（各时间段收益、风险调整后收益）
  4. 风险特征对比（回撤、波动率、夏普比率等）
  5. 净值走势分析（趋势、相关性、关键节点）
  6. 管理人背景对比（如有数据）
  7. 综合评估与投资建议

分析对象：${subjects.join("、")}

注意：如果某项数据缺失，请明确标注"数据不足"，不要编造数据。对于计算结果，请确保逻辑正确。`
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

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => controller.enqueue(encodeEvent(data))

      try {
        // ── Phase 1: Planning ────────────────────────────────────────────────
        emit({ type: "phase", phase: "planning", message: "正在规划分析方案..." })

        const planModel = getChatModel(false)
        const planResponse = await planModel.invoke([
          new SystemMessage(`你是一位专业私募基金研究员。用户希望对以下对象进行同策略对比分析：${subjects.join("、")}。

请用中文简要说明你将如何进行分析（包括：分析角度、重点关注维度、预期报告结构）。控制在200字以内，语言简练专业。`),
          new HumanMessage(`请为"${subjects.join("、")}"的对比分析生成分析规划。`),
        ])
        const planText = typeof planResponse.content === "string"
          ? planResponse.content
          : JSON.stringify(planResponse.content)
        emit({ type: "plan_text", content: planText })
        emit({ type: "plan_done" })

        // ── Phase 2: Fetch fund data ─────────────────────────────────────────
        emit({ type: "step_start", step: 1, title: "搜索并匹配基金/管理人信息" })
        const funds = await fetchFundsBySubjects(subjects)
        const foundNames = funds.map((f) => f.product_name)
        emit({
          type: "step_done",
          step: 1,
          title: "搜索并匹配基金/管理人信息",
          summary: funds.length > 0
            ? `找到 ${funds.length} 只基金：${foundNames.slice(0, 3).join("、")}${funds.length > 3 ? `等` : ""}`
            : "未在数据库中找到匹配基金，将基于输入名称进行分析",
          data: { count: funds.length, names: foundNames },
        })

        // ── Phase 3: Fetch NAV ───────────────────────────────────────────────
        emit({ type: "step_start", step: 2, title: "获取净值历史数据" })
        const beianHaos = funds.map((f) => f.beian_hao)
        const navMap = await fetchNavHistory(beianHaos)
        const totalNavPoints = Object.values(navMap).reduce((s, v) => s + v.length, 0)
        emit({
          type: "step_done",
          step: 2,
          title: "获取净值历史数据",
          summary: totalNavPoints > 0
            ? `获取了 ${totalNavPoints} 条净值记录（近24个月）`
            : "暂无净值历史数据",
          data: { totalPoints: totalNavPoints },
        })

        // ── Phase 4: Fetch manager info ──────────────────────────────────────
        emit({ type: "step_start", step: 3, title: "获取管理人背景信息" })
        const managerNames = [...new Set(funds.map((f) => f.manager).filter(Boolean))]
        const managers = await fetchManagerInfo(managerNames)
        emit({
          type: "step_done",
          step: 3,
          title: "获取管理人背景信息",
          summary: managers.length > 0
            ? `获取了 ${managers.length} 家管理人信息`
            : "未找到管理人详细信息",
          data: { count: managers.length },
        })

        // ── Phase 5: Query KB (if path provided) ────────────────────────────
        emit({ type: "step_start", step: 4, title: "查询知识库相关文档" })
        let kbContext = ""
        if (body.kbPath && body.kbPath.trim()) {
          try {
            const { askKnowledgeBaseQuestion } = await import("@/lib/server/knowledge-chat")
            const kbQuestion = `关于${subjects.join("、")}的策略特点、历史表现、风险控制和投资方法有哪些信息？`
            const kbResult = await askKnowledgeBaseQuestion({
              question: kbQuestion,
              folderPath: body.kbPath.trim(),
              useBm25: true,
              modelMode: "turbo",
            })
            kbContext = kbResult.answer
            emit({
              type: "step_done",
              step: 4,
              title: "查询知识库相关文档",
              summary: `知识库检索完成（来源文档: ${kbResult.sources?.length ?? 0}）`,
              data: { sources: kbResult.sources },
            })
          } catch (kbErr) {
            emit({
              type: "step_done",
              step: 4,
              title: "查询知识库相关文档",
              summary: "知识库查询失败，跳过此步骤",
            })
          }
        } else {
          emit({
            type: "step_done",
            step: 4,
            title: "查询知识库相关文档",
            summary: "未指定知识库路径，跳过此步骤（可在任务设置中指定）",
          })
        }

        // ── Phase 6: Generate report ─────────────────────────────────────────
        emit({ type: "phase", phase: "report", message: "正在生成分析报告..." })

        const dataSummary = buildDataSummary(funds, navMap, managers)
        const userPrompt = [
          `请基于以下数据，生成"${subjects.join("、")}"的专业对比分析报告。`,
          "",
          dataSummary,
          kbContext ? `\n=== 知识库补充信息 ===\n${kbContext}` : "",
          "",
          `如果某些基金数据缺失或部分字段为N/A，请在报告中注明并基于可用数据进行分析。`,
        ].filter((l) => l !== undefined).join("\n")

        const reportModel = getChatModel(true)
        const reportStream = await reportModel.stream([
          new SystemMessage(buildReportSystemPrompt(subjects)),
          new HumanMessage(userPrompt),
        ])

        for await (const chunk of reportStream) {
          const delta = typeof chunk.content === "string" ? chunk.content : ""
          if (delta) {
            emit({ type: "report_text", delta })
          }
        }

        emit({ type: "done" })
      } catch (err) {
        console.error("[ai-researcher/compare-analysis]", err)
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "分析过程中发生错误",
        })
      } finally {
        controller.close()
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
