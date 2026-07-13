import { NextResponse } from "next/server"
import { ChatOpenAI } from "@langchain/openai"
import { getUserById } from "@/lib/server/users"
import {
  getKnowledgeBaseFile,
  readFileDocumentText,
  normalizeKnowledgeBasePath,
  collectKnowledgeBaseDocuments,
} from "@/lib/server/knowledge-base"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getDashScopeApiKey() {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error("缺少 DASHSCOPE_API_KEY，无法启用路演分析")
  return apiKey
}

function getDashScopeBaseUrl() {
  return process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
}

function getAnalysisModel() {
  return process.env.DASHSCOPE_ANALYSIS_MODEL || process.env.DASHSCOPE_CHAT_MODEL || "qwen-max"
}

export type RoadshowFindingSeverity = "high" | "medium" | "low"

export type RoadshowFindingCategory =
  | "strategy_inconsistency"
  | "position_contradiction"
  | "alpha_vs_beta"
  | "narrative_inconsistency"
  | "capacity_blindspot"
  | "survivorship_bias"
  | "unfalsifiable_thesis"
  | "fee_drag_obfuscation"
  | "concentration_risk"
  | "cherry_picked_inception"
  | "undisclosed_leverage"
  | "backtest_as_live"
  | "benchmark_gaming"
  | "liquidity_risk_ignored"
  | "attribution_mismatch"
  | "style_drift"
  | "overfit_strategy"
  | "risk_metric_misleading"
  | "missing_disclosure"
  | "other"

export type RoadshowFinding = {
  category: RoadshowFindingCategory
  severity: RoadshowFindingSeverity
  title: string
  description: string
  evidence: string
  contradiction: string
  recommendation: string
}

export type RoadshowAnalysisResult = {
  ok: boolean
  summary: string
  overallRisk: "high" | "medium" | "low" | "clean"
  findings: RoadshowFinding[]
  documentsAnalyzed: string[]
  fundMetrics?: FundMetricsContext | null
  error?: string
}

type FundMetricsContext = {
  fundName: string
  beianHao: string
  strategy: string | null
  inceptionDate: string | null
  aumEstimate: string | null
  annualizedReturn: number | null
  maxDrawdown: number | null
  sharpeRatio: number | null
  volatility: number | null
  correlationWithCsi300: number | null
  navCount: number
  recentNavTrend: string | null
}

async function fetchFundMetrics(beianHao: string): Promise<FundMetricsContext | null> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         fi.jijin_mingcheng,
         fi.beian_hao,
         fi.celue_fenlei,
         fi.chengli_riqi,
         fi.guimo_wan,
         fi.nian_hua_shouyilv,
         fi.zui_da_huituo,
         fi.xia_pu_bilv,
         fi.nian_hua_bizhun_cha,
         (SELECT COUNT(*) FROM private_fund_nav n WHERE n.beian_hao = fi.beian_hao) AS nav_count
       FROM private_fund_info fi
       WHERE fi.beian_hao = $1
       LIMIT 1`,
      [beianHao],
    )
    if (!rows.length) return null
    const r = rows[0]

    // Attempt to compute correlation with CSI 300 from NAV series
    let corrCsi300: number | null = null
    try {
      const navRows = await query<{ nav_date: string; nav_value: number }>(
        `SELECT nav_date, nav_value FROM private_fund_nav WHERE beian_hao = $1 ORDER BY nav_date`,
        [beianHao],
      )
      if (navRows.length >= 20) {
        // Compute monthly returns from NAV
        const monthlyFundReturns: number[] = []
        const monthlyDates: string[] = []
        for (let i = 1; i < navRows.length; i++) {
          const prev = navRows[i - 1].nav_value
          const curr = navRows[i].nav_value
          if (prev > 0) {
            monthlyFundReturns.push((curr - prev) / prev)
            monthlyDates.push(navRows[i].nav_date)
          }
        }

        // Query CSI 300 benchmark returns for same dates
        if (monthlyDates.length >= 10) {
          const benchRows = await query<{ trade_date: string; close_price: number }>(
            `SELECT trade_date::text, close_price
             FROM index_daily_price
             WHERE index_code = '000300.SH'
               AND trade_date >= $1 AND trade_date <= $2
             ORDER BY trade_date`,
            [monthlyDates[0], monthlyDates[monthlyDates.length - 1]],
          )

          if (benchRows.length >= 10) {
            const benchReturns: number[] = []
            for (let i = 1; i < benchRows.length; i++) {
              const prev = benchRows[i - 1].close_price
              const curr = benchRows[i].close_price
              if (prev > 0) benchReturns.push((curr - prev) / prev)
            }
            const n = Math.min(monthlyFundReturns.length, benchReturns.length)
            if (n >= 10) {
              const fund = monthlyFundReturns.slice(0, n)
              const bench = benchReturns.slice(0, n)
              corrCsi300 = pearsonCorrelation(fund, bench)
            }
          }
        }
      }
    } catch {
      // correlation computation is best-effort
    }

    return {
      fundName: String(r.jijin_mingcheng || ""),
      beianHao: String(r.beian_hao || beianHao),
      strategy: r.celue_fenlei ? String(r.celue_fenlei) : null,
      inceptionDate: r.chengli_riqi ? String(r.chengli_riqi) : null,
      aumEstimate: r.guimo_wan != null ? `${Number(r.guimo_wan).toFixed(0)} 万元` : null,
      annualizedReturn: r.nian_hua_shouyilv != null ? Number(r.nian_hua_shouyilv) : null,
      maxDrawdown: r.zui_da_huituo != null ? Number(r.zui_da_huituo) : null,
      sharpeRatio: r.xia_pu_bilv != null ? Number(r.xia_pu_bilv) : null,
      volatility: r.nian_hua_bizhun_cha != null ? Number(r.nian_hua_bizhun_cha) : null,
      correlationWithCsi300: corrCsi300,
      navCount: Number(r.nav_count || 0),
      recentNavTrend: null,
    }
  } catch {
    return null
  }
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length
  const meanX = x.reduce((s, v) => s + v, 0) / n
  const meanY = y.reduce((s, v) => s + v, 0) / n
  let cov = 0
  let stdX = 0
  let stdY = 0
  for (let i = 0; i < n; i++) {
    cov += (x[i] - meanX) * (y[i] - meanY)
    stdX += (x[i] - meanX) ** 2
    stdY += (y[i] - meanY) ** 2
  }
  const denom = Math.sqrt(stdX * stdY)
  return denom === 0 ? 0 : cov / denom
}

function buildAnalysisPrompt(documents: Array<{ name: string; text: string }>, fundMetrics: FundMetricsContext | null): string {
  const docsSection = documents
    .map((d) => `=== 文件: ${d.name} ===\n${d.text.slice(0, 8000)}`)
    .join("\n\n")

  const metricsSection = fundMetrics
    ? `
## 数据库中的基金实际数据（用于交叉比对）
- 基金名称: ${fundMetrics.fundName}
- 备案号: ${fundMetrics.beianHao}
- 策略类型: ${fundMetrics.strategy ?? "未知"}
- 成立日期: ${fundMetrics.inceptionDate ?? "未知"}
- 规模估算: ${fundMetrics.aumEstimate ?? "未知"}
- 年化收益率: ${fundMetrics.annualizedReturn != null ? `${(fundMetrics.annualizedReturn * 100).toFixed(2)}%` : "未知"}
- 最大回撤: ${fundMetrics.maxDrawdown != null ? `${(fundMetrics.maxDrawdown * 100).toFixed(2)}%` : "未知"}
- 夏普比率: ${fundMetrics.sharpeRatio != null ? fundMetrics.sharpeRatio.toFixed(2) : "未知"}
- 年化波动率: ${fundMetrics.volatility != null ? `${(fundMetrics.volatility * 100).toFixed(2)}%` : "未知"}
- 与沪深300相关系数: ${fundMetrics.correlationWithCsi300 != null ? fundMetrics.correlationWithCsi300.toFixed(3) : "未知（数据不足）"}
- 净值数据条数: ${fundMetrics.navCount}
`
    : "\n## 未提供基金实际数据（仅基于路演文本分析逻辑一致性）\n"

  return `你是一位专业的私募基金尽职调查分析师，专门负责识别路演材料（路演PPT、月报、季报、产品说明书等）中的逻辑漏洞、前后矛盾、信息误导和潜在欺诈风险。

${metricsSection}

## 待分析的路演文档内容

${docsSection}

## 分析任务

请对上述路演材料进行系统性的逻辑漏洞排查。你需要尽可能挖掘各类潜在问题，不应放过任何可疑之处。

**重点检查以下逻辑陷阱类型：**

### A. 策略与净值不一致类
1. **市场中性策略但净值与市场高度相关** - 若策略声称市场中性/绝对收益，但净值在市场大涨大跌时同步波动，说明对冲不足
2. **观点与净值反向** - 路演宣称看多某资产（黄金、煤炭、消费等），但该资产上涨时基金净值却下跌，暗示实际仓位与宣传相反
3. **Alpha vs Beta混淆** - 宣称收益来自选股Alpha，但净值与沪深300/中证500高度相关（相关系数>0.8），实为承担Beta风险
4. **风格漂移** - 路演宣称某策略（如纯量化、CTA），但持仓或净值表现更像另一策略（如主观多头）

### B. 历史叙事矛盾类
5. **事后解释前后不一** - 同一笔交易，路演中给出的理由与历史月报中的表述截然不同（如月报写"避险对冲"，路演改口成"预判红利"）
6. **"万金油"论点** - 对某一宏观判断，无论结果如何都能自圆其说（如"地缘动荡利好资源品→资源品涨了归功于此；资源品跌了就说风险偏好回升"）
7. **业绩成因漂移** - 好年份归功于主动管理能力，差年份归咎于外部环境，从不承认策略局限

### C. 规模与容量类
8. **容量陷阱** - 展示小规模跑出的高收益曲线，募资目标却是10倍以上的规模扩张。高频套利、小市值轮动等策略对市场冲击成本极为敏感
9. **流动性风险淡化** - 集中持仓冷门小盘股却宣称"随时可以止损减仓"，忽视市值/流动性限制

### D. 幸存者偏差类
10. **基金遴选偏差** - 同一公司有多只方向相反的产品，路演只展示盈利那只（一只做多一只做空，哪只赚了就路演哪只）
11. **历史清仓择时偏差** - 展示"净值曲线"时略去亏损严重的产品或账户

### E. 收益质量类
12. **费前vs费后收益** - 展示的是毛收益（未扣除交易费用），高换手率策略每年可能被手续费吃掉5-10%
13. **杠杆隐藏** - 夏普比率异常高（>2.5）但波动率极低，可能底层资产加了高倍杠杆（债券+期货杠杆常见模式）
14. **数据挖掘过拟合** - 量化策略的历史回测胜率/收益异常完美，暗示参数过度优化，实盘不可复制

### F. 时间窗口操纵类
15. **精心挑选起始日期** - 基金成立于熊市底部（2019年初、2020年3月、2022年10月），展示"成立以来收益"巧妙规避了前一轮下跌
16. **滚动收益选择性** - 只展示对自己有利的时间窗口（"过去3年20%年化"），不展示从2021年高点算起的收益

### G. 信息披露缺失类
17. **关键风险因子未披露** - 宣称高夏普但不披露杠杆倍数、集中度、最大单日跌幅等
18. **回测与实盘混淆** - 将部分回测数据与实盘数据拼接成一条完整净值曲线，不加区分标注
19. **超额收益基准选择不当** - 选择表现极差的基准来夸大超额收益（如用国债利率作为权益产品基准）

### H. 逻辑结构性问题
20. **因果倒置** - 将相关性解读为因果（"我们持有的股票都上涨了，说明我们的研究框架有效"）
21. **样本量不足** - 3-5年数据就宣称策略的统计有效性，忽视策略周期性失效风险
22. **过度强调团队背景** - 以名校/大厂背景替代真实的策略逻辑和风控框架

---

## 输出要求

请严格按照以下JSON格式输出，不要输出任何JSON以外的内容：

\`\`\`json
{
  "summary": "一段简洁的总体评估（100-200字），说明该路演材料的整体可信度和主要风险点",
  "overallRisk": "high | medium | low | clean",
  "findings": [
    {
      "category": "strategy_inconsistency | position_contradiction | alpha_vs_beta | narrative_inconsistency | capacity_blindspot | survivorship_bias | unfalsifiable_thesis | fee_drag_obfuscation | concentration_risk | cherry_picked_inception | undisclosed_leverage | backtest_as_live | benchmark_gaming | liquidity_risk_ignored | attribution_mismatch | style_drift | overfit_strategy | risk_metric_misleading | missing_disclosure | other",
      "severity": "high | medium | low",
      "title": "简洁的问题标题（15字以内）",
      "description": "详细描述该逻辑漏洞或矛盾（50-150字）",
      "evidence": "路演文档中的原始表述（直接引用）",
      "contradiction": "与之矛盾的数据、逻辑或已知信息",
      "recommendation": "建议进一步核查的问题或方向"
    }
  ]
}
\`\`\`

注意：
- findings 按严重程度由高到低排列
- 如果某类问题在文档中确实存在明确证据，才列入findings；不要无中生有
- 但也不要因为某类数据缺失就忽略明显的文字逻辑矛盾
- 每个finding的category必须是上面列出的枚举值之一
- 若整体材料逻辑自洽、风险较小，overallRisk可以为 "clean" 或 "low"，findings数组可以较少`
}

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const filePaths: string[] = Array.isArray(body?.filePaths)
      ? body.filePaths.map((p: unknown) => String(p).trim()).filter(Boolean)
      : []
    const folderPath: string = String(body?.folderPath || "").trim()
    const fundBeianHao: string = String(body?.fundBeianHao || "").trim()

    if (!filePaths.length && !folderPath) {
      return NextResponse.json({ ok: false, error: "请选择要分析的文件或文件夹" }, { status: 400 })
    }

    // Collect document texts
    const documents: Array<{ name: string; text: string; relativePath: string }> = []
    const MAX_TOTAL_CHARS = 80_000

    if (filePaths.length > 0) {
      for (const rawPath of filePaths) {
        const normalized = normalizeKnowledgeBasePath(rawPath)
        if (!normalized) continue
        try {
          const file = await getKnowledgeBaseFile(normalized)
          const text = await readFileDocumentText(file.absolutePath, file.extension)
          documents.push({ name: file.name, text, relativePath: normalized })
        } catch {
          // skip unreadable files
        }
      }
    } else if (folderPath) {
      try {
        const collected = await collectKnowledgeBaseDocuments(folderPath)
        for (const doc of collected) {
          try {
            const file = await getKnowledgeBaseFile(doc.relativePath)
            const text = await readFileDocumentText(file.absolutePath, file.extension)
            documents.push({ name: file.name, text, relativePath: doc.relativePath })
          } catch {
            // skip
          }
        }
      } catch {
        return NextResponse.json({ ok: false, error: "无法读取该文件夹" }, { status: 400 })
      }
    }

    if (!documents.length) {
      return NextResponse.json({ ok: false, error: "未找到可分析的文档，请确认所选文件包含可读取的文本内容" }, { status: 400 })
    }

    // Trim total content to fit context window
    let totalChars = 0
    const trimmedDocs = documents.map((d) => {
      const remaining = Math.max(0, MAX_TOTAL_CHARS - totalChars)
      const trimmed = d.text.slice(0, remaining)
      totalChars += trimmed.length
      return { name: d.name, text: trimmed }
    })

    // Fetch fund metrics from DB
    let fundMetrics: FundMetricsContext | null = null
    if (fundBeianHao) {
      fundMetrics = await fetchFundMetrics(fundBeianHao)
    }

    // Build and call LLM
    const prompt = buildAnalysisPrompt(trimmedDocs, fundMetrics)

    const model = new ChatOpenAI({
      apiKey: getDashScopeApiKey(),
      model: getAnalysisModel(),
      temperature: 0.1,
      streaming: false,
      configuration: { baseURL: getDashScopeBaseUrl() },
    })

    const response = await model.invoke([{ role: "user", content: prompt }])
    const raw = typeof response.content === "string" ? response.content : String(response.content)

    // Extract JSON from markdown code block or raw JSON
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/)
    if (!jsonMatch) {
      return NextResponse.json<RoadshowAnalysisResult>({
        ok: false,
        summary: "分析完成，但无法解析结构化结果",
        overallRisk: "medium",
        findings: [],
        documentsAnalyzed: documents.map((d) => d.relativePath),
        error: "模型返回了非结构化内容: " + raw.slice(0, 500),
      })
    }

    let parsed: { summary: string; overallRisk: string; findings: RoadshowFinding[] }
    try {
      parsed = JSON.parse(jsonMatch[1])
    } catch {
      return NextResponse.json<RoadshowAnalysisResult>({
        ok: false,
        summary: "JSON解析失败",
        overallRisk: "medium",
        findings: [],
        documentsAnalyzed: documents.map((d) => d.relativePath),
        error: "JSON解析错误",
      })
    }

    const result: RoadshowAnalysisResult = {
      ok: true,
      summary: String(parsed.summary || ""),
      overallRisk: (["high", "medium", "low", "clean"].includes(parsed.overallRisk) ? parsed.overallRisk : "medium") as RoadshowAnalysisResult["overallRisk"],
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      documentsAnalyzed: documents.map((d) => d.relativePath),
      fundMetrics,
    }

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json<RoadshowAnalysisResult>({
      ok: false,
      summary: "",
      overallRisk: "medium",
      findings: [],
      documentsAnalyzed: [],
      error: err?.message || String(err),
    }, { status: 500 })
  }
}
