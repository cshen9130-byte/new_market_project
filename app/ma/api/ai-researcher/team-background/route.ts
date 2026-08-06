import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import {
  formatTeamBackgroundForPrompt,
  searchTeamBackground,
} from "@/lib/server/team-background-search"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function getChatModel(streaming = false) {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error("缺少 DASHSCOPE_API_KEY")
  return new ChatOpenAI({
    apiKey,
    model: process.env.DASHSCOPE_ANALYSIS_MODEL || process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
    temperature: 0.2,
    streaming,
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.warn(`[team-background] ${label} timed out after ${ms}ms`)
        resolve(fallback)
      }, ms)
    }),
  ])
}

function encodeEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

function buildReportPrompt(keyword: string, evidence: string): string {
  return `你是一位专业私募基金研究员，擅长从高管履历与尽调材料中识别团队从业背景。

用户希望找出「团队有【${keyword}】背景的私募管理人」。

以下是系统从 AMAC 高管履历与 AI 知识库中检索到的结构化证据（已做别名扩展与常见干扰项排除，仍可能有漏检/误检）：

${evidence}

请基于上述证据撰写 Markdown 研究报告，必须包含以下章节（按顺序）：

1. **检索口径与关键词** — 说明主关键词、扩展别名、数据来源与排除规则
2. **核心结论** — 命中管理人数量、多人背景管理人数量、知识库旁证要点（100-200字）
3. **重点管理人** — 优先列出：①多人命中；②知识库明确写到核心人员/创始人曾任职该机构的管理人。每人给简要履历要点
4. **完整名单表** — 用 Markdown 表格列出尽可能多的管理人：管理人 | 登记编号 | 背景人数 | 代表人员与履历摘要
5. **知识库旁证** — 摘录材料中明确写团队/核心人员背景的来源与要点；若仅为外资席位/研报引用等非团队背景，请标注「非团队背景提及」
6. **需甄别项** — 名称含关键词但未必具备该机构履历的管理人；合资路径等干扰项
7. **局限与建议** — AMAC 仅披露高管、基金经理可能未入表、知识库覆盖不全等

要求：
- 只根据提供的证据写作，不要编造未出现的管理人或履历
- 语言专业简洁，适合投研内部传阅
- 表格优先，重点部分可用条目列表`
}

export async function POST(req: Request) {
  let body: { keyword?: string; aliases?: string[]; kbPath?: string } = {}
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 })
  }

  const keyword = String(body.keyword ?? "").trim()
  if (!keyword) {
    return new Response(JSON.stringify({ error: "请输入背景机构关键词，例如 UBS、高盛、中金" }), {
      status: 400,
    })
  }
  const aliases = Array.isArray(body.aliases)
    ? body.aliases.map((a) => String(a).trim()).filter(Boolean)
    : []
  const kbPath = String(body.kbPath ?? "").trim()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        try {
          controller.enqueue(encodeEvent(data))
        } catch {
          /* closed */
        }
      }

      // ── Planning ──────────────────────────────────────────────────────────
      try {
        emit({ type: "phase", phase: "planning", message: "正在制定团队背景检索方案..." })
        const planModel = getChatModel(false)
        const planResp = await withTimeout(
          planModel.invoke([
            new SystemMessage("你是私募基金研究员，擅长团队背景尽调。"),
            new HumanMessage(
              `用户希望找出团队有「${keyword}」背景的私募管理人${kbPath ? `，知识库范围：${kbPath}` : "，知识库全库检索"}。\n`
                + "请用不超过150字说明检索思路：别名扩展、AMAC高管履历、知识库尽调材料、名称命中甄别、报告结构。",
            ),
          ]),
          18_000,
          null,
          "planning",
        )
        const planText = planResp
          ? (typeof planResp.content === "string" ? planResp.content : JSON.stringify(planResp.content))
          : "（规划超时，直接进入检索阶段：将检索 AMAC 高管履历与知识库文档，并生成结构化名单报告。）"
        emit({ type: "plan_text", content: planText })
        emit({ type: "plan_done" })
      } catch (err) {
        emit({ type: "plan_text", content: `规划出错：${(err as Error).message}` })
        emit({ type: "plan_done" })
      }

      // ── Step 1-4 via shared search ─────────────────────────────────────────
      emit({ type: "step_start", step: 1, title: "扩展关键词并检索 AMAC 高管履历" })
      let result
      try {
        result = await withTimeout(
          searchTeamBackground({ keyword, aliases, kbPath, maxManagers: 120, maxKbHits: 40 }),
          60_000,
          null,
          "searchTeamBackground",
        )
        if (!result) {
          emit({ type: "step_done", step: 1, summary: "履历检索超时，将尝试继续后续步骤" })
          emit({ type: "error", message: "数据库检索超时，请稍后重试或缩小关键词范围" })
          controller.close()
          return
        }
        emit({
          type: "step_done",
          step: 1,
          summary:
            `别名：${result.aliases.slice(0, 6).join("、")}${result.aliases.length > 6 ? "…" : ""}；`
            + `命中履历 ${result.summary.trueMatchResumeRows} 条，涉及管理人 ${result.summary.trueMatchManagers} 家`
            + (result.excludedResumeCount > 0 ? `（已排除干扰 ${result.excludedResumeCount} 条）` : ""),
        })
      } catch (err) {
        emit({ type: "step_done", step: 1, summary: `履历检索出错：${(err as Error).message}` })
        emit({ type: "error", message: `检索失败：${(err as Error).message}` })
        controller.close()
        return
      }

      emit({ type: "step_start", step: 2, title: "检索知识库尽调/路演材料" })
      emit({
        type: "step_done",
        step: 2,
        summary:
          result.summary.kbChunkMatches > 0
            ? `知识库命中 ${result.summary.kbChunkMatches} 条切片，归纳 ${result.kbHits.length} 个来源`
              + (kbPath ? `（范围：${kbPath}）` : "（全库）")
            : `知识库未命中「${keyword}」相关文本${kbPath ? `（范围：${kbPath}）` : ""}`,
      })

      emit({ type: "step_start", step: 3, title: "汇总管理人并甄别名称命中" })
      const topNames = result.managers
        .slice(0, 5)
        .map((m) => `${m.manager_name}(${m.personCount}人)`)
        .join("、")
      emit({
        type: "step_done",
        step: 3,
        summary:
          result.managers.length > 0
            ? `有效管理人 ${result.managers.length} 家（多人 ${result.summary.multiPersonManagers}）；`
              + `名称含关键词待甄别 ${result.nameOnlyManagers.length} 家。前列：${topNames}`
            : `未在 AMAC 履历中找到明确「${keyword}」雇主记录；将主要依据知识库旁证撰写`,
      })

      emit({ type: "step_start", step: 4, title: "整理雇主分布与证据包" })
      const evidence = formatTeamBackgroundForPrompt(result, { maxManagers: 80, maxKbHits: 30 })
      emit({
        type: "step_done",
        step: 4,
        summary:
          `雇主类型 ${result.employerBreakdown.length} 种；证据包约 ${evidence.length.toLocaleString()} 字，准备生成报告`,
      })

      if (result.managers.length === 0 && result.kbHits.length === 0 && result.nameOnlyManagers.length === 0) {
        emit({ type: "step_start", step: 5, title: "生成团队背景筛选报告" })
        const emptyReport =
          `# 团队有「${keyword}」背景的私募筛选报告\n\n`
          + `## 核心结论\n\n`
          + `在当前 AMAC 高管履历与知识库索引中，未检索到与「${keyword}」匹配的团队背景记录。\n\n`
          + `## 建议\n\n`
          + `- 尝试英文/中文别名（如 UBS / 瑞银）\n`
          + `- 确认知识库是否已完成嵌入索引\n`
          + `- 确认 AMAC 高管履历 ETL 是否已同步\n`
        emit({ type: "report_text", delta: emptyReport })
        emit({ type: "step_done", step: 5, summary: "未找到匹配数据，已输出空结果说明" })
        emit({ type: "done" })
        controller.close()
        return
      }

      // ── Step 5: LLM report ────────────────────────────────────────────────
      emit({ type: "step_start", step: 5, title: "生成团队背景筛选报告" })
      try {
        const reportModel = getChatModel(true)
        const reportStream = await reportModel.stream([
          new SystemMessage("你是私募基金研究员，请输出规范的 Markdown 研究报告，不要编造证据之外的事实。"),
          new HumanMessage(buildReportPrompt(keyword, evidence)),
        ])

        let fullReport = ""
        for await (const chunk of reportStream) {
          const delta = typeof chunk.content === "string" ? chunk.content : ""
          if (delta) {
            fullReport += delta
            emit({ type: "report_text", delta })
          }
        }

        emit({
          type: "step_done",
          step: 5,
          summary: `报告生成完成，共约 ${fullReport.length.toLocaleString()} 字`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 5, summary: `报告生成失败：${(err as Error).message}` })
        emit({ type: "error", message: `生成报告时出错：${(err as Error).message}` })
      }

      emit({ type: "done" })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
