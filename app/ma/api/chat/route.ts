import { NextRequest } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"

const DEEPSEEK_BASE = "https://api.deepseek.com/v1"
const DEEPSEEK_MODEL = "deepseek-chat"

// DashScope OpenAI-compatible endpoint (used for vision queries)
const DASHSCOPE_BASE =
  process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
// Override via DASHSCOPE_VISION_MODEL env var; qwen-vl-plus is the most widely
// accessible vision model — qwen-vl-max-latest requires explicit activation in
// the Aliyun Model Studio console (will error with "Access denied" if not enabled).
const VISION_MODEL = process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-plus"

// ── Database schema digest injected into every system message ─────────────────
const SCHEMA_NOTE = `
你有权访问以下 PostgreSQL 数据库表（使用 query_database 工具查询）：

【日频行情】
- raw_nhci_daily(trade_date DATE, close NUMERIC) — 南华商品指数每日收盘
- raw_nheci_daily(trade_date DATE, close NUMERIC) — 南华能化指数每日收盘
- raw_futures_daily(ts_code VARCHAR, symbol VARCHAR, trade_date DATE, close, settle, pre_close, pre_settle, settle_return NUMERIC)
    symbol: IH|IF|IC|IM；ts_code 如 IF2506.CFX, IFL.CFX(近月连续), IFL1.CFX(主力), IFL2.CFX, IFL3.CFX
- raw_spot_daily(symbol VARCHAR, trade_date DATE, close NUMERIC, source VARCHAR) — symbol: IH|IF|IC|IM
- raw_commodity_amount_daily(trade_date DATE, code VARCHAR, name VARCHAR, sector VARCHAR, return_pct NUMERIC, amount BIGINT)

【基差（衍生）】
- derived_futures_snapshot(symbol, trade_date, ts_code, close, settle, settle_return, near_ts_code, near_close, near_settle, near_settle_return, far_ts_code, far_close, far_settle, far_settle_return) — 最新快照
- derived_basis_daily(symbol, trade_date, basis_type VARCHAR, futures_ts_code, spot_close, futures_settle, days_to_maturity INT, expiry_date DATE, annualized_basis_pct NUMERIC, basis_diff NUMERIC) — basis_type: 'far'|'near'
- derived_basis_cont_daily(symbol, trade_date, leg VARCHAR, futures_ts_code, spot_close, futures_settle, basis_diff NUMERIC) — leg: L|L1|L2|L3

【ETF 与市场预测】
- raw_etf_daily(trade_date DATE, ticker VARCHAR, field VARCHAR, value NUMERIC) — ticker: 510300.SH 510500.SH 511010.SH 511220.SH 511880.SH 518880.SH
- current_market_prediction(trade_date DATE, cluster SMALLINT, pc1 NUMERIC, pc2 NUMERIC, freq VARCHAR) — freq='daily'|'weekly'；cluster 0-4

【宏观 & 经济状态】
- macro_indicators_monthly(month DATE PK, pmi, afre, m1, cpi, yield_10y, spread_10y1y, nhci)
- regime_similarity_top(run_date DATE, rank SMALLINT, similar_month DATE, distance NUMERIC, pmi_chg_z, yield_chg_z, spread_chg_z, nhci_yoy_z, afre_z, m1_z, cpi_z) — 最相似历史区间（rank=1最相似）
- regime_current_zscores(run_date DATE PK, current_month DATE, pmi_chg_z, yield_chg_z, spread_chg_z, nhci_yoy_z, afre_z, m1_z, cpi_z)
- regime_all_distances(run_date DATE, hist_month DATE, distance NUMERIC)

【货币信用】
- shibor_3m_monthly(month DATE PK, shibor_3m_close NUMERIC)
- money_credit_cycle(month DATE PK, social, shibor, social_ma, shibor_ma, social_slope, shibor_slope, monetary_state TEXT, credit_state TEXT, monetary TEXT, credit TEXT, quadrant TEXT) — quadrant 如'宽货币-宽信用'

【MOM 提成】
- mom_carry_rates(key VARCHAR PK, value NUMERIC)
- mom_carry_payments(id, account, start_date, carry_date, operating_days INT, balance NUMERIC, total_profit NUMERIC, profit_portion NUMERIC, paid_child_carry NUMERIC, note TEXT)

【运维】
- pipeline_runs(job_name, step_name, started_at, finished_at, status, trade_date, rows_affected, error_message)

查询规范：只用 SELECT，必须含 LIMIT（建议≤100行，时间序列可到500行），日期格式 'YYYY-MM-DD'。

**【强制规则】** ①需要数据时：工具调用必须是响应的**第一个且唯一的动作**，禁止在调用前输出任何文字。②需要多次查询时：在同一轮响应中一次性发起所有工具调用，不要分多轮。③纯概念/功能说明时：直接文字回答，不调用工具。`

// ── Tool definition ────────────────────────────────────────────────────────────
const DB_QUERY_TOOL = {
  type: "function",
  function: {
    name: "query_database",
    description:
      "对 market dashboard PostgreSQL 数据库执行只读 SQL 查询，获取行情、基差、宏观指标、市场预测、MOM 提成等数据。当用户询问具体数值、历史走势、最新数据、数据对比时调用此工具。",
    parameters: {
      type: "object",
      required: ["sql"],
      properties: {
        sql: {
          type: "string",
          description:
            "只读 SELECT 查询语句，必须以 SELECT 或 WITH 开头，必须包含 LIMIT 子句（最多 200 行）。",
        },
      },
    },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildSystemContent() {
  return [
    "你是一个金融市场分析助手，专门帮助市场监控系统（MOM管理系统、期货市场看板）的用户理解数据、解读图表、回答分析问题。",
    "请用简洁专业的中文回答。如果问题超出金融市场范畴，也可以正常回答。",
    "用户的每条消息末尾会附带 [当前页面：...] 标记，以说明用户发送该消息时所在的页面，请据此回答与页面功能相关的问题。",
    SCHEMA_NOTE,
  ]
    .filter(Boolean)
    .join("\n")
}

function sseResponse(body: ReadableStream) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  })
}

/** Only allow pure read queries – no write / DDL ops */
function isSelectOnly(sql: string): boolean {
  const norm = sql.trim().toUpperCase()
  if (!norm.startsWith("SELECT") && !norm.startsWith("WITH")) return false
  return !/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|CALL|COPY|VACUUM|ANALYSE|ANALYZE)\b/.test(
    norm,
  )
}

// ── Main handler ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { messages, pageContext, screenshot, documentContext } = await req.json()

  if (!Array.isArray(messages)) {
    return Response.json({ error: "messages must be an array" }, { status: 400 })
  }

  const systemContent = buildSystemContent()
  const systemMsg = { role: "system", content: systemContent }

  // Stamp the page context directly onto the last user message so it stays
  // co-located with the question even after the conversation grows long.
  const stampedMessages = messages.map((m: Record<string, unknown>, i: number) => {
    if (i === messages.length - 1 && m.role === "user") {
      let content = String(m.content ?? "")
      if (pageContext) content += `\n\n[当前页面：${pageContext}]`
      const docName = typeof documentContext?.name === "string" ? documentContext.name.trim() : ""
      const docText = typeof documentContext?.text === "string" ? documentContext.text.trim() : ""
      if (docName) {
        content += docText
          ? `\n\n[当前阅读文档：${docName}]\n${docText}`
          : `\n\n[当前阅读文档：${docName}（未能提取文字内容，请结合文件名作答或告知用户）]`
      }
      return { ...m, content }
    }
    return m
  })

  // ── Vision path: screenshot attached → DashScope Qwen-VL ──────────────────
  if (screenshot) {
    const dashKey = process.env.DASHSCOPE_API_KEY
    if (!dashKey) {
      return Response.json({ error: "DASHSCOPE_API_KEY not configured" }, { status: 500 })
    }

    const prior = stampedMessages.slice(0, -1)
    const lastUser = stampedMessages[stampedMessages.length - 1]
    const visionMessages = [
      systemMsg,
      ...prior,
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: screenshot } },
          { type: "text", text: (lastUser?.content as string) ?? "" },
        ],
      },
    ]

    const res = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dashKey}`,
      },
      body: JSON.stringify({ model: VISION_MODEL, messages: visionMessages, stream: true }),
    })
    if (!res.ok) {
      const raw = await res.text()
      let message = `DashScope API 错误 (${res.status})`
      try {
        const parsed = JSON.parse(raw)
        message = parsed?.message || parsed?.error?.message || parsed?.error || message
      } catch { /* raw is not JSON */ }
      return Response.json({ error: message }, { status: 500 })
    }
    return sseResponse(res.body as ReadableStream)
  }

  // ── Text path: DeepSeek with DB tool (streaming + tool-call interception) ──
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return Response.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 500 })
  }

  const enc = new TextEncoder()

  function encodeSSE(content: string) {
    return enc.encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    )
  }

  // ── DSML fallback parser ─────────────────────────────────────────────────────
  // DeepSeek sometimes embeds tool calls as <｜DSML｜invoke…> XML in `content`
  // instead of the proper `tool_calls` JSON field.
  const PIPE = "\uFF5C" // ｜ U+FF5C full-width vertical line
  function parseDSML(content: string): Array<{ id: string; name: string; arguments: string }> {
    const results: Array<{ id: string; name: string; arguments: string }> = []
    const invokeRe = new RegExp(
      `<${PIPE}DSML${PIPE}invoke name="([^"]+)">([\s\S]*?)<\\/${PIPE}DSML${PIPE}invoke>`,
      "g",
    )
    const paramRe = new RegExp(
      `<${PIPE}DSML${PIPE}parameter name="([^"]+)"[^>]*>([\\s\\S]*?)<\\/${PIPE}DSML${PIPE}parameter>`,
      "g",
    )
    let m: RegExpExecArray | null
    let idx = 0
    while ((m = invokeRe.exec(content)) !== null) {
      const toolName = m[1]
      const inner = m[2]
      const params: Record<string, string> = {}
      let p: RegExpExecArray | null
      paramRe.lastIndex = 0
      while ((p = paramRe.exec(inner)) !== null) params[p[1]] = p[2].trim()
      results.push({ id: `dsml_${idx++}`, name: toolName, arguments: JSON.stringify(params) })
    }
    return results
  }

  // Strip DSML markup from text so it's never shown to the user
  function stripDSML(content: string) {
    const start = new RegExp(`<${PIPE}DSML${PIPE}function_calls>[\\s\\S]*$`)
    return content.replace(start, "").trimEnd()
  }

  // ── Execute a list of tool calls, returns tool result messages ────────────────
  type ToolCall = { id: string; type?: string; function: { name: string; arguments: string } }

  async function runToolCalls(toolCalls: ToolCall[]) {
    return Promise.all(
      toolCalls.map(async (tc) => {
        if (tc.function.name !== "query_database") {
          return { id: tc.id, rows: 0, content: JSON.stringify({ error: `未知工具：${tc.function.name}` }) }
        }
        let sql: string
        try {
          sql = (JSON.parse(tc.function.arguments) as { sql: string }).sql
        } catch {
          return { id: tc.id, rows: 0, content: JSON.stringify({ error: "参数解析失败" }) }
        }
        if (!isSelectOnly(sql)) {
          return { id: tc.id, rows: 0, content: JSON.stringify({ error: "安全限制：只允许 SELECT 查询" }) }
        }
        try {
          const rows = await query(sql)
          return { id: tc.id, rows: rows.length, content: JSON.stringify(rows.slice(0, 200)) }
        } catch (e: unknown) {
          return { id: tc.id, rows: 0, content: JSON.stringify({ error: (e as Error).message }) }
        }
      }),
    )
  }

  // DSML open-tag marker — keep a trailing guard this long to catch cross-chunk splits
  const DSML_OPEN = `<${PIPE}DSML${PIPE}function_calls>`
  const GUARD = DSML_OPEN.length

  const outputStream = new ReadableStream({
    async start(controller) {
      const dec = new TextDecoder()
      function emit(content: string) { controller.enqueue(encodeSSE(content)) }
      function endStream() { controller.enqueue(enc.encode("data: [DONE]\n\n")); controller.close() }
      function fail(msg: string) { emit(msg); endStream() }

      try {
        const loopMessages: Record<string, unknown>[] = [systemMsg, ...stampedMessages]
        let totalQueries = 0
        let totalRows = 0
        let prevRoundHadTools = false
        const MAX_ROUNDS = 5

        for (let round = 0; round < MAX_ROUNDS; round++) {
          // Emit the cumulative indicator right before any round that follows tool execution
          if (prevRoundHadTools) {
            emit(`*[已查询数据库 ${totalQueries} 次，合计 ${totalRows} 行]*\n\n`)
            prevRoundHadTools = false
          }

          const resp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: DEEPSEEK_MODEL,
              messages: loopMessages,
              tools: [DB_QUERY_TOOL],
              tool_choice: "auto",
              stream: true,   // ← always streaming for live TTFB
            }),
          })

          if (!resp.ok) { fail(`⚠️ 请求失败：${await resp.text()}`); return }

          // ── Stream this round ─────────────────────────────────────────────
          const reader = resp.body!.getReader()
          let contentSoFar = ""
          let emitCursor = 0
          let dsmlDetected = false
          const properTCMap = new Map<number, ToolCall>()
          let hasProperTC = false

          while (true) {
            const { value, done: rdone } = await reader.read()
            if (rdone) break

            const text = dec.decode(value, { stream: true })
            for (const line of text.split("\n")) {
              if (!line.startsWith("data: ")) continue
              const raw = line.slice(6).trim()
              if (!raw || raw === "[DONE]") continue
              let parsed: Record<string, unknown>
              try { parsed = JSON.parse(raw) } catch { continue }

              type TcDelta = { index?: number; id?: string; function?: { name?: string; arguments?: string } }
              type Delta = { content?: string; tool_calls?: TcDelta[] }
              const delta = (parsed.choices as Array<{ delta: Delta }>)?.[0]?.delta
              if (!delta) continue

              // Accumulate proper tool_calls (arrive as index-keyed streaming deltas)
              if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
                hasProperTC = true
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0
                  if (!properTCMap.has(idx)) {
                    properTCMap.set(idx, { id: "", type: "function", function: { name: "", arguments: "" } })
                  }
                  const e = properTCMap.get(idx)!
                  if (tc.id) e.id = tc.id
                  if (tc.function?.name) e.function.name += tc.function.name
                  if (tc.function?.arguments) e.function.arguments += tc.function.arguments
                }
              }

              // Stream content live with a tiny DSML guard buffer
              if (delta.content != null && !hasProperTC) {
                contentSoFar += delta.content
                if (!dsmlDetected) {
                  const dsmlStart = contentSoFar.indexOf(DSML_OPEN)
                  if (dsmlStart === -1) {
                    // Emit all but trailing guard bytes (handles split across chunks)
                    const safeEnd = Math.max(emitCursor, contentSoFar.length - GUARD)
                    if (safeEnd > emitCursor) {
                      emit(contentSoFar.slice(emitCursor, safeEnd))
                      emitCursor = safeEnd
                    }
                  } else {
                    // Emit text up to where DSML starts, then stop
                    if (dsmlStart > emitCursor) {
                      emit(contentSoFar.slice(emitCursor, dsmlStart))
                      emitCursor = dsmlStart
                    }
                    dsmlDetected = true
                  }
                }
              }
            }
          }

          // ── End of stream: determine what happened ────────────────────────
          const properTCs = Array.from(properTCMap.values()).filter(t => t.id && t.function.name)
          const hasDSML = dsmlDetected || (!hasProperTC && contentSoFar.includes(DSML_OPEN))

          if (!hasProperTC && !hasDSML) {
            // Pure text answer — flush remaining guard buffer and close
            if (emitCursor < contentSoFar.length) emit(contentSoFar.slice(emitCursor))
            endStream()
            return
          }

          // ── Resolve which tool calls to run ───────────────────────────────
          let toolCallsToRun: ToolCall[]
          if (hasProperTC && properTCs.length > 0) {
            toolCallsToRun = properTCs
          } else {
            toolCallsToRun = parseDSML(contentSoFar).map(p => ({
              id: p.id, type: "function",
              function: { name: p.name, arguments: p.arguments },
            }))
          }

          if (toolCallsToRun.length === 0) {
            if (emitCursor < contentSoFar.length) emit(contentSoFar.slice(emitCursor))
            endStream()
            return
          }

          // Execute all tool calls in parallel
          const results = await runToolCalls(toolCallsToRun)
          totalQueries += toolCallsToRun.length
          totalRows += results.reduce((s, r) => s + r.rows, 0)
          prevRoundHadTools = true

          // Append assistant + tool result messages for next round
          loopMessages.push({
            role: "assistant",
            content: hasProperTC ? null : (stripDSML(contentSoFar).trim() || null),
            tool_calls: toolCallsToRun.map(tc => ({ id: tc.id, type: "function", function: tc.function })),
          })
          for (const r of results) {
            loopMessages.push({ role: "tool", tool_call_id: r.id, content: r.content })
          }
        }

        fail("⚠️ 超过最大工具调用轮次")
      } catch (err: unknown) {
        controller.enqueue(encodeSSE(`⚠️ 服务器错误：${(err as Error).message}`))
        controller.enqueue(enc.encode("data: [DONE]\n\n"))
        controller.close()
      }
    },
  })

  return sseResponse(outputStream)
}
