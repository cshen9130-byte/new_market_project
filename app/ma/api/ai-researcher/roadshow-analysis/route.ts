import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { query } from "@/lib/db"
import {
  getKnowledgeBaseFile,
  readFileDocumentText,
  normalizeKnowledgeBasePath,
  collectKnowledgeBaseDocuments,
} from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// ── LLM helpers ─────────────────────────────────────────────────────────────

function getChatModel(streaming = false) {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error("缺少 DASHSCOPE_API_KEY")
  return new ChatOpenAI({
    apiKey,
    model: process.env.DASHSCOPE_ANALYSIS_MODEL || process.env.DASHSCOPE_CHAT_MODEL || "qwen-max",
    temperature: 0.15,
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
        console.warn(`[roadshow-analysis] ${label} timed out after ${ms}ms`)
        resolve(fallback)
      }, ms)
    }),
  ])
}

function encodeEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// ── DB helpers ───────────────────────────────────────────────────────────────

interface FundMetrics {
  product_name: string
  beian_hao: string
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  max_drawdown: string | null
  volatility: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  aum_estimate: string | null
  correlation_csi300: number | null
}

async function fetchFundMetrics(beianHao: string): Promise<FundMetrics | null> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         fi.jijin_mingcheng     AS product_name,
         fi.beian_hao,
         fi.celue_fenlei        AS strategy_l1,
         NULL::text             AS strategy_l2,
         fi.chengli_riqi::text  AS inception_date,
         fi.nian_hua_shouyilv::text AS ret_1y,
         fi.xia_pu_bilv::text       AS sharpe_1y,
         NULL::text             AS calmar_1y,
         fi.zui_da_huituo::text AS max_drawdown,
         fi.nian_hua_bizhun_cha::text AS volatility,
         (SELECT nav_value::text FROM private_fund_nav WHERE beian_hao = fi.beian_hao ORDER BY nav_date DESC LIMIT 1) AS latest_nav,
         (SELECT nav_date::text  FROM private_fund_nav WHERE beian_hao = fi.beian_hao ORDER BY nav_date DESC LIMIT 1) AS latest_nav_date,
         fi.guimo_wan::text     AS aum_estimate
       FROM private_fund_info fi
       WHERE fi.beian_hao = $1
       LIMIT 1`,
      [beianHao],
    )
    if (!rows.length) return null

    // Try computing correlation with CSI 300
    let correlation: number | null = null
    try {
      const navRows = await query<{ nav_date: string; nav_value: number }>(
        `SELECT nav_date::text AS nav_date, nav_value FROM private_fund_nav WHERE beian_hao = $1 ORDER BY nav_date`,
        [beianHao],
      )
      if (navRows.length >= 24) {
        const fundRets: number[] = []
        const fundDates: string[] = []
        for (let i = 1; i < navRows.length; i++) {
          const prev = navRows[i - 1].nav_value
          const curr = navRows[i].nav_value
          if (prev > 0) { fundRets.push((curr - prev) / prev); fundDates.push(navRows[i].nav_date) }
        }
        const benchRows = await query<{ trade_date: string; close_price: number }>(
          `SELECT trade_date::text, close_price FROM index_daily_price
           WHERE index_code = '000300.SH' AND trade_date >= $1 AND trade_date <= $2
           ORDER BY trade_date`,
          [fundDates[0], fundDates[fundDates.length - 1]],
        )
        if (benchRows.length >= 20) {
          const benchRets: number[] = []
          for (let i = 1; i < benchRows.length; i++) {
            const p = benchRows[i - 1].close_price, c = benchRows[i].close_price
            if (p > 0) benchRets.push((c - p) / p)
          }
          const n = Math.min(fundRets.length, benchRets.length)
          if (n >= 12) {
            const fx = fundRets.slice(0, n), bx = benchRets.slice(0, n)
            const mf = fx.reduce((s, v) => s + v, 0) / n
            const mb = bx.reduce((s, v) => s + v, 0) / n
            let cov = 0, sf = 0, sb = 0
            for (let i = 0; i < n; i++) { cov += (fx[i] - mf) * (bx[i] - mb); sf += (fx[i] - mf) ** 2; sb += (bx[i] - mb) ** 2 }
            const d = Math.sqrt(sf * sb)
            correlation = d > 0 ? Math.round((cov / d) * 1000) / 1000 : null
          }
        }
      }
    } catch { /* correlation is best-effort */ }

    const r = rows[0]
    return {
      product_name: String(r.product_name || ""),
      beian_hao: beianHao,
      strategy_l1: r.strategy_l1 ? String(r.strategy_l1) : null,
      strategy_l2: null,
      inception_date: r.inception_date ? String(r.inception_date) : null,
      ret_1y: r.ret_1y ? String(r.ret_1y) : null,
      sharpe_1y: r.sharpe_1y ? String(r.sharpe_1y) : null,
      calmar_1y: null,
      max_drawdown: r.max_drawdown ? String(r.max_drawdown) : null,
      volatility: r.volatility ? String(r.volatility) : null,
      latest_nav: r.latest_nav ? String(r.latest_nav) : null,
      latest_nav_date: r.latest_nav_date ? String(r.latest_nav_date) : null,
      aum_estimate: r.aum_estimate ? `${Number(r.aum_estimate).toFixed(0)} 万元` : null,
      correlation_csi300: correlation,
    }
  } catch {
    return null
  }
}

// ── Document reader ──────────────────────────────────────────────────────────

async function readDocuments(kbPath: string): Promise<Array<{ name: string; text: string }>> {
  const normalized = normalizeKnowledgeBasePath(kbPath)
  const docs: Array<{ name: string; text: string }> = []

  // Try as folder first
  try {
    const collected = await collectKnowledgeBaseDocuments(normalized || "")
    const MAX_CHARS = 100_000
    let total = 0
    for (const doc of collected) {
      if (total >= MAX_CHARS) break
      try {
        const file = await getKnowledgeBaseFile(doc.relativePath)
        const text = await readFileDocumentText(file.absolutePath, file.extension)
        const slice = text.slice(0, MAX_CHARS - total)
        if (slice.trim()) { docs.push({ name: file.name, text: slice }); total += slice.length }
      } catch { /* skip unreadable */ }
    }
  } catch {
    // Try as single file
    if (normalized) {
      try {
        const file = await getKnowledgeBaseFile(normalized)
        const text = await readFileDocumentText(file.absolutePath, file.extension)
        if (text.trim()) docs.push({ name: file.name, text: text.slice(0, 100_000) })
      } catch { /* ignore */ }
    }
  }
  return docs
}

// ── Analysis prompt ──────────────────────────────────────────────────────────

function buildAnalysisPrompt(
  docs: Array<{ name: string; text: string }>,
  metrics: FundMetrics | null,
): string {
  const docSection = docs
    .map((d) => `=== 文件: ${d.name} ===\n${d.text}`)
    .join("\n\n---\n\n")

  const metricsSection = metrics
    ? `## 数据库实际基金数据（用于交叉验证）
- 基金名称: ${metrics.product_name}
- 备案号: ${metrics.beian_hao}
- 策略类型: ${metrics.strategy_l1 ?? "未知"}
- 成立日期: ${metrics.inception_date ?? "未知"}
- 规模估算: ${metrics.aum_estimate ?? "未知"}
- 年化收益: ${metrics.ret_1y != null ? `${(Number(metrics.ret_1y) * 100).toFixed(2)}%` : "未知"}
- 最大回撤: ${metrics.max_drawdown != null ? `${(Number(metrics.max_drawdown) * 100).toFixed(2)}%` : "未知"}
- 夏普比率: ${metrics.sharpe_1y ?? "未知"}
- 年化波动率: ${metrics.volatility != null ? `${(Number(metrics.volatility) * 100).toFixed(2)}%` : "未知"}
- 与沪深300相关系数: ${metrics.correlation_csi300 != null ? metrics.correlation_csi300 : "数据不足"}`
    : "（未提供备案号，仅基于文档内容做逻辑一致性分析）"

  return `你是一位顶级私募基金尽职调查专家，专门识别路演材料、月报、产品说明书中的逻辑漏洞与风险信号。

${metricsSection}

## 待分析路演文档

${docSection}

## 分析任务

对上述材料进行系统性逻辑排查，覆盖但不限于以下22类问题：

**A. 策略与净值一致性**
1. 市场中性/绝对收益策略但净值随市场大幅波动（若有沪深300相关系数>0.6则重点标注）
2. 路演看多某资产，但该资产上涨时净值反而下跌（方向性矛盾）
3. 宣称收益来自Alpha选股，但净值与沪深300/中证500高度相关（实为Beta风险）
4. 策略风格漂移（路演说量化，持仓或净值更像主观多头）

**B. 历史叙事一致性**
5. 同一笔交易在路演中的解释与历史月报表述不同（事后改口）
6. "万金油"论点：无论市场如何变化，都能自圆其说（逻辑不可证伪）
7. 好年份归功于能力，差年份归咎于市场（业绩成因漂移）

**C. 容量与规模**
8. 用小规模跑出的高收益曲线募集大资金（高频/小盘策略容量限制被忽视）
9. 宣称高收益且可以随时止损，但持仓以冷门小盘股为主（流动性矛盾）

**D. 幸存者偏差**
10. 只展示旗下盈利产品（同一公司可能有方向相反的产品）
11. 展示的净值曲线跳过了亏损严重的阶段

**E. 收益质量**
12. 展示毛收益（未扣除交易费用），高换手策略手续费损耗被隐藏
13. 夏普比率异常高但未披露杠杆（债券+期货杠杆常见）
14. 量化回测胜率/曲线过于完美（参数过拟合，实盘难复制）

**F. 时间窗口选择**
15. 成立于熊市底部，"成立以来"收益规避了前一轮下跌
16. 选择性展示对自己有利的滚动窗口

**G. 信息披露**
17. 高夏普但不披露杠杆倍数、集中度、最大单日跌幅
18. 回测数据与实盘数据拼接成一条曲线但不加区分标注
19. 以表现差的基准（如国债）夸大超额收益

**H. 逻辑结构**
20. 将相关性误当因果（"我们买的股票都涨了，说明研究框架有效"）
21. 3-5年数据就宣称统计有效性，忽视策略失效周期
22. 用名校/大厂背景代替策略逻辑（背景替代实质）

---

请以Markdown格式输出结构化的尽调报告，包含：

1. **总体风险评估**（高风险/中度风险/低风险/逻辑自洽）+ 100字总结
2. **问题清单**：每个问题包含：
   - 问题标题（严重程度：🔴高/🟡中/⚪低）
   - 具体描述（路演原文引用 + 矛盾所在）
   - 建议核查方向
3. **需要进一步核实的关键问题**（列出5个最重要的尽调问题）
4. **综合结论**

注意：仅列出文档中确实存在证据的问题，不要无中生有；同时也不要因为数据不全就忽略文字逻辑矛盾。`
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { kbPath?: string; beianHao?: string } = {}
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 })
  }

  const kbPath = String(body.kbPath ?? "").trim()
  if (!kbPath) {
    return new Response(JSON.stringify({ error: "请提供路演材料路径" }), { status: 400 })
  }
  const beianHao = String(body.beianHao ?? "").trim()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        try { controller.enqueue(encodeEvent(data)) } catch { /* closed */ }
      }

      // ── Planning ──────────────────────────────────────────────────────────
      try {
        emit({ type: "phase", phase: "planning", message: "正在制定路演尽调分析方案..." })
        const planModel = getChatModel(false)
        const planResp = await withTimeout(
          planModel.invoke([
            new SystemMessage("你是私募基金尽职调查专家。"),
            new HumanMessage(
              `用户希望对路径"${kbPath}"中的路演材料进行逻辑漏洞审查${beianHao ? `，对应基金备案号为 ${beianHao}` : ""}。\n请简述尽调思路：包括重点检查哪些维度（策略一致性、历史叙事、容量约束、幸存者偏差等）、若有数据库数据如何交叉验证，控制在150字以内。`,
            ),
          ]),
          18_000,
          { content: "（规划超时，直接进入文档读取阶段）" },
          "planning",
        )
        const planText = typeof planResp.content === "string" ? planResp.content : JSON.stringify(planResp.content)
        emit({ type: "plan_text", content: planText })
        emit({ type: "plan_done" })
      } catch (err) {
        emit({ type: "plan_text", content: `规划出错：${(err as Error).message}` })
        emit({ type: "plan_done" })
      }

      // ── Step 1: Read documents ─────────────────────────────────────────────
      let docs: Array<{ name: string; text: string }> = []
      emit({ type: "step_start", step: 1, title: "读取路演文档" })
      try {
        docs = await withTimeout(readDocuments(kbPath), 30_000, [], "readDocuments")
        emit({
          type: "step_done", step: 1,
          summary: docs.length > 0
            ? `成功读取 ${docs.length} 份文档（${docs.map((d) => d.name).slice(0, 3).join("、")}${docs.length > 3 ? ` 等` : ""}），合计约 ${docs.reduce((s, d) => s + d.text.length, 0).toLocaleString()} 字`
            : `未能在路径"${kbPath}"中找到可读文档，请确认路径是否正确`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 1, summary: `文档读取出错：${(err as Error).message}` })
      }

      if (!docs.length) {
        emit({ type: "error", message: `在路径"${kbPath}"中未找到可读文档，请确认路径是否正确并重试` })
        controller.close()
        return
      }

      // ── Step 2: Fetch fund metrics from DB ────────────────────────────────
      let metrics: FundMetrics | null = null
      emit({ type: "step_start", step: 2, title: "查询数据库基金指标" })
      if (beianHao) {
        try {
          metrics = await withTimeout(fetchFundMetrics(beianHao), 12_000, null, "fetchMetrics")
          emit({
            type: "step_done", step: 2,
            summary: metrics
              ? `已获取基金数据：${metrics.product_name}，策略：${metrics.strategy_l1 ?? "未知"}，年化收益：${metrics.ret_1y != null ? `${(Number(metrics.ret_1y) * 100).toFixed(1)}%` : "N/A"}，最大回撤：${metrics.max_drawdown != null ? `${(Number(metrics.max_drawdown) * 100).toFixed(1)}%` : "N/A"}，与沪深300相关性：${metrics.correlation_csi300 ?? "N/A"}`
              : `数据库中未找到备案号"${beianHao}"对应的基金，将仅基于文档逻辑分析`,
          })
        } catch (err) {
          emit({ type: "step_done", step: 2, summary: `数据库查询出错：${(err as Error).message}` })
        }
      } else {
        emit({ type: "step_done", step: 2, summary: "未提供备案号，跳过数据库交叉验证（仅基于文档内容分析）" })
      }

      // ── Step 3: Analyze strategy vs NAV consistency ───────────────────────
      emit({ type: "step_start", step: 3, title: "分析策略与净值一致性" })
      // This is done inside the main LLM call; emit a quick summary
      const strategyClue = metrics
        ? `已准备好基金实际数据（相关系数${metrics.correlation_csi300 ?? "N/A"}，夏普${metrics.sharpe_1y ?? "N/A"}，最大回撤${metrics.max_drawdown ?? "N/A"}）用于一致性检验`
        : "将从文档内容提取策略声明并进行逻辑推演"
      emit({ type: "step_done", step: 3, summary: strategyClue })

      // ── Step 4: Detect narrative inconsistencies ──────────────────────────
      emit({ type: "step_start", step: 4, title: "检测历史叙事矛盾" })
      const docNames = docs.map((d) => d.name).join("、")
      emit({
        type: "step_done", step: 4,
        summary: `正在跨文档扫描时间线矛盾（文档包含：${docNames.slice(0, 120)}${docNames.length > 120 ? "..." : ""}）`,
      })

      // ── Step 5: Generate report (streaming) ───────────────────────────────
      emit({ type: "step_start", step: 5, title: "生成尽调风险报告" })
      try {
        const prompt = buildAnalysisPrompt(docs, metrics)
        const reportModel = getChatModel(true)
        const reportStream = await reportModel.stream([
          new SystemMessage("你是私募基金尽职调查专家，请输出规范的Markdown格式报告。"),
          new HumanMessage(prompt),
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
          type: "step_done", step: 5,
          summary: `报告生成完成，共约 ${fullReport.length} 字`,
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
