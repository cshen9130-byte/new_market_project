import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function getChatModel(streaming = false) {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error("缺少 DASHSCOPE_API_KEY")
  return new ChatOpenAI({
    apiKey,
    model: process.env.DASHSCOPE_ANALYSIS_MODEL || process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
    temperature: 0.15,
    streaming,
    configuration: {
      baseURL:
        process.env.DASHSCOPE_BASE_URL ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  })
}

function encodeEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

// ── DB Queries ──────────────────────────────────────────────────────────────

interface ManagerRow {
  manager_name: string
  legal_rep_name: string | null
  org_type: string | null
  registration_no: string | null
  reg_city: string | null
  inception_date: Date | null
  registration_date: Date | null
  active_fund_count: number | null
  member_type: string | null
  has_alert_info: string | null
  has_integrity_info: string | null
  manager_id: string | null
  updated_at: Date | null
}

interface ManagerDetailRow {
  manager_name_cn: string | null
  manager_name_en: string | null
  registered_address: string | null
  office_address: string | null
  registered_capital_cny_wan: string | null
  paid_in_capital_cny_wan: string | null
  paid_in_capital_ratio: string | null
  enterprise_nature: string | null
  business_type: string | null
  mgmt_scale_range: string | null
  is_investment_advisory_third_party: string | null
  actual_controller: string | null
  law_firm_name: string | null
  lawyer_name: string | null
  is_member: string | null
  org_code: string | null
}

interface ExecutiveRow {
  person_name: string
  title: string | null
  has_fund_qualification: string | null
  qualification_method: string | null
}

interface ResumeRow {
  person_name: string
  executive_title: string | null
  period: string | null
  employer: string | null
  department: string | null
  title: string | null
}

interface FundRow {
  fund_name: string
  fund_no: string | null
  fund_type: string | null
  working_state: string | null
  mandator_name: string | null
  establish_date: Date | null
  put_on_record_date: Date | null
}

interface NavRow {
  beian_hao: string
  product_name: string | null
  price_date: Date | null
  nav: string | null
  cumulative_nav: string | null
}

interface MetricsRow {
  snapshot_date: Date | null
  mgmt_scale_range: string | null
  active_fund_count: number | null
  staff_count: number | null
}

interface PersonOrgRow {
  staff_count: number | null
  fund_qualification_count: number | null
  investment_manager_count: number | null
  fund_manager_count: number | null
}

interface PrivateFundInfoRow {
  beian_hao: string
  product_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: Date | null
  benchmark: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  latest_nav: string | null
  latest_nav_date: Date | null
}

async function fetchManagerData(managerName: string) {
  const like = `%${managerName}%`

  const managers = await withTimeout(
    query<ManagerRow>(
      `SELECT manager_name, legal_rep_name, org_type, registration_no, reg_city,
              inception_date, registration_date, active_fund_count, member_type,
              has_alert_info, has_integrity_info, manager_id, updated_at
       FROM amac_managers
       WHERE manager_name ILIKE $1
       LIMIT 5`,
      [like],
    ),
    8000,
    [] as ManagerRow[],
  )

  const regNo = managers[0]?.registration_no ?? null

  const details = regNo
    ? await withTimeout(
        query<ManagerDetailRow>(
          `SELECT manager_name_cn, manager_name_en, registered_address, office_address,
                  registered_capital_cny_wan, paid_in_capital_cny_wan, paid_in_capital_ratio,
                  enterprise_nature, business_type, mgmt_scale_range,
                  is_investment_advisory_third_party, actual_controller,
                  law_firm_name, lawyer_name, is_member, org_code
           FROM amac_manager_details
           WHERE registration_no = $1
           LIMIT 1`,
          [regNo],
        ),
        8000,
        [] as ManagerDetailRow[],
      )
    : []

  const executives = regNo
    ? await withTimeout(
        query<ExecutiveRow>(
          `SELECT person_name, title, has_fund_qualification, qualification_method
           FROM amac_manager_executives
           WHERE registration_no = $1
           ORDER BY id`,
          [regNo],
        ),
        8000,
        [] as ExecutiveRow[],
      )
    : []

  const resumes = regNo
    ? await withTimeout(
        query<ResumeRow>(
          `SELECT person_name, executive_title, period, employer, department, title
           FROM amac_manager_executive_resume
           WHERE registration_no = $1
           ORDER BY person_name, period`,
          [regNo],
        ),
        10000,
        [] as ResumeRow[],
      )
    : []

  const funds = await withTimeout(
    query<FundRow>(
      `SELECT fund_name, fund_no, fund_type, working_state, mandator_name,
              establish_date, put_on_record_date
       FROM amac_private_funds
       WHERE manager_name ILIKE $1
       ORDER BY establish_date`,
      [like],
    ),
    8000,
    [] as FundRow[],
  )

  const perfInfo = await withTimeout(
    query<PrivateFundInfoRow>(
      `SELECT beian_hao, product_name, strategy_l1, strategy_l2, inception_date,
              benchmark, ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
              sharpe_1y, calmar_1y, latest_nav, latest_nav_date
       FROM private_fund_info
       WHERE manager ILIKE $1
       ORDER BY latest_nav_date DESC NULLS LAST`,
      [like],
    ),
    8000,
    [] as PrivateFundInfoRow[],
  )

  const fundNosWithPerf = perfInfo
    .filter((f) => f.latest_nav !== null)
    .map((f) => f.beian_hao)
    .slice(0, 5)

  let navHistory: NavRow[] = []
  if (fundNosWithPerf.length > 0) {
    navHistory = await withTimeout(
      query<NavRow>(
        `SELECT beian_hao, product_name, price_date, nav, cumulative_nav
         FROM private_fund_nav
         WHERE beian_hao = ANY($1)
         ORDER BY beian_hao, price_date DESC
         LIMIT 200`,
        [fundNosWithPerf],
      ),
      10000,
      [] as NavRow[],
    )
  }

  const metrics = regNo
    ? await withTimeout(
        query<MetricsRow>(
          `SELECT snapshot_date, mgmt_scale_range, active_fund_count, staff_count
           FROM amac_manager_metrics_history
           WHERE registration_no = $1
           ORDER BY snapshot_date DESC
           LIMIT 3`,
          [regNo],
        ),
        5000,
        [] as MetricsRow[],
      )
    : []

  const personOrg = await withTimeout(
    query<PersonOrgRow>(
      `SELECT staff_count, fund_qualification_count, investment_manager_count, fund_manager_count
       FROM amac_person_org_stats
       WHERE org_name ILIKE $1
       LIMIT 1`,
      [like],
    ),
    5000,
    [] as PersonOrgRow[],
  )

  return { managers, details, executives, resumes, funds, perfInfo, navHistory, metrics, personOrg }
}

// ── Format data for LLM prompt ───────────────────────────────────────────────

function fmt(date: Date | null): string {
  if (!date) return "—"
  return new Date(date).toISOString().slice(0, 10)
}

function buildDataContext(
  managerName: string,
  data: Awaited<ReturnType<typeof fetchManagerData>>,
): string {
  const { managers, details, executives, resumes, funds, perfInfo, navHistory, metrics, personOrg } = data
  const m = managers[0]
  const d = details[0]
  const p = personOrg[0]

  const lines: string[] = []

  lines.push(`## 管理人基本信息`)
  if (m) {
    lines.push(`- 全称：${m.manager_name}`)
    lines.push(`- 法定代表人：${m.legal_rep_name ?? "—"}`)
    lines.push(`- 机构类型：${m.org_type ?? "—"}`)
    lines.push(`- 登记编号：${m.registration_no ?? "—"}`)
    lines.push(`- 注册地：${m.reg_city ?? "—"}`)
    lines.push(`- 成立日期：${fmt(m.inception_date)}`)
    lines.push(`- 登记日期：${fmt(m.registration_date)}`)
    lines.push(`- 在运作基金数：${m.active_fund_count ?? "—"}`)
    lines.push(`- 会员类型：${m.member_type ?? "—"}`)
    lines.push(`- 有预警信息：${m.has_alert_info ?? "—"}`)
    lines.push(`- 有诚信信息：${m.has_integrity_info ?? "—"}`)
  } else {
    lines.push(`（AMAC 数据库中未找到精确匹配「${managerName}」的管理人记录）`)
  }

  if (d) {
    lines.push(`- 英文名：${d.manager_name_en ?? "—"}`)
    lines.push(`- 组织机构代码：${d.org_code ?? "—"}`)
    lines.push(`- 注册地址：${d.registered_address ?? "—"}`)
    lines.push(`- 办公地址：${d.office_address ?? "—"}`)
    lines.push(`- 注册资本：${d.registered_capital_cny_wan ?? "—"} 万元`)
    lines.push(`- 实缴资本：${d.paid_in_capital_cny_wan ?? "—"} 万元（比率 ${d.paid_in_capital_ratio ?? "—"}）`)
    lines.push(`- 企业性质：${d.enterprise_nature ?? "—"}`)
    lines.push(`- 业务类型：${d.business_type?.replace(/&nbsp;/g, " ").trim() ?? "—"}`)
    lines.push(`- 管理规模区间：${d.mgmt_scale_range ?? "—"}`)
    lines.push(`- 实际控制人：${d.actual_controller ?? "—"}`)
    lines.push(`- 是否会员：${d.is_member ?? "—"}`)
    lines.push(`- 法律顾问律所：${d.law_firm_name ?? "—"}`)
    lines.push(`- 法律顾问律师：${d.lawyer_name ?? "—"}`)
    lines.push(`- 是否投顾第三方：${d.is_investment_advisory_third_party ?? "—"}`)
  }

  if (p) {
    lines.push(`- 员工人数：${p.staff_count ?? "—"}（其中持基金从业资格：${p.fund_qualification_count ?? "—"}，投资经理：${p.investment_manager_count ?? "—"}，基金经理：${p.fund_manager_count ?? "—"}）`)
  }

  if (metrics.length > 0) {
    lines.push(`- 最新管理规模快照（${fmt(metrics[0].snapshot_date)}）：${metrics[0].mgmt_scale_range ?? "—"}，在运作基金 ${metrics[0].active_fund_count ?? "—"} 只，员工 ${metrics[0].staff_count ?? "—"} 人`)
  }

  lines.push(`\n## 核心团队（${executives.length} 人）`)
  for (const e of executives) {
    lines.push(`- ${e.person_name}：${e.title ?? "—"}；基金从业资格：${e.has_fund_qualification ?? "—"}（${e.qualification_method ?? "—"}）`)
  }

  if (resumes.length > 0) {
    lines.push(`\n## 高管履历`)
    const byPerson: Record<string, ResumeRow[]> = {}
    for (const r of resumes) {
      ;(byPerson[r.person_name] ??= []).push(r)
    }
    for (const [person, rows] of Object.entries(byPerson)) {
      lines.push(`\n### ${person}`)
      for (const r of rows) {
        lines.push(`- ${r.period ?? "—"} | ${r.employer ?? "—"} | ${r.department ?? ""} | ${r.title ?? "—"}`)
      }
    }
  }

  lines.push(`\n## 产品备案（共 ${funds.length} 只）`)
  const active = funds.filter((f) => f.working_state === "正在运作")
  const closed = funds.filter((f) => f.working_state !== "正在运作")
  lines.push(`正在运作：${active.length} 只 | 已清算/其他：${closed.length} 只`)
  for (const f of funds) {
    lines.push(`- [${f.working_state ?? "—"}] ${f.fund_name}（${f.fund_no ?? "—"}）成立：${fmt(f.establish_date)}，托管：${f.mandator_name ?? "—"}`)
  }

  if (perfInfo.length > 0) {
    lines.push(`\n## 基金业绩指标`)
    for (const pf of perfInfo) {
      const parts = [
        `产品：${pf.product_name ?? pf.beian_hao}`,
        pf.strategy_l1 ? `策略：${pf.strategy_l1}${pf.strategy_l2 ? "/" + pf.strategy_l2 : ""}` : null,
        pf.latest_nav ? `最新净值：${pf.latest_nav}（${fmt(pf.latest_nav_date)}）` : null,
        pf.ret_1w ? `近1周：${pf.ret_1w}%` : null,
        pf.ret_1m ? `近1月：${pf.ret_1m}%` : null,
        pf.ret_3m ? `近3月：${pf.ret_3m}%` : null,
        pf.ret_6m ? `近6月：${pf.ret_6m}%` : null,
        pf.ret_1y ? `近1年：${pf.ret_1y}%` : null,
        pf.sharpe_1y ? `Sharpe(1y)：${pf.sharpe_1y}` : null,
        pf.calmar_1y ? `Calmar(1y)：${pf.calmar_1y}` : null,
        pf.benchmark ? `基准：${pf.benchmark}` : null,
      ].filter(Boolean)
      lines.push(`- ${parts.join(" | ")}`)
    }
  }

  if (navHistory.length > 0) {
    lines.push(`\n## 净值历史（部分产品近期数据）`)
    const byFund: Record<string, NavRow[]> = {}
    for (const n of navHistory) {
      ;(byFund[n.beian_hao] ??= []).push(n)
    }
    for (const [beianHao, rows] of Object.entries(byFund)) {
      const productName = rows[0]?.product_name ?? beianHao
      lines.push(`\n### ${productName}（${beianHao}）`)
      for (const r of rows.slice(0, 12)) {
        lines.push(`- ${fmt(r.price_date)}：单位净值 ${r.nav ?? "—"}，累计净值 ${r.cumulative_nav ?? "—"}`)
      }
    }
  }

  return lines.join("\n")
}

function buildReportPrompt(managerName: string, dataContext: string): string {
  return `你是一位专业私募基金研究员，请基于以下从数据库中提取的结构化数据，撰写一份关于「${managerName}」的深度调研报告。

【数据来源】中国基金业协会（AMAC）公开登记信息、内部净值数据库（截至最新同步日期）。

【原始数据】
${dataContext}

请生成专业的 Markdown 格式调研报告，必须按以下章节顺序组织（无数据的章节请标注"数据暂缺"，不要省略章节）：

# 一、公司基本信息
包含：公司全称、英文名称、登记编号、机构类型、业务类型、成立日期、登记日期、注册地址、办公地址、注册/实缴资本、实际控制人、会员类型、诚信信息、法律顾问等关键字段，以 Markdown 表格呈现。

# 二、核心团队
2.1 主要管理人员：以表格列出姓名、职务、基金从业资格情况。
2.2 核心创始人履历：重点展示法定代表人/实际控制人的从业经历（按时间顺序），分析其行业背景与资历。
2.3 其他高管履历：简要梳理其他核心人员的从业轨迹。
2.4 团队点评：简要评价团队背景、专业深度、期限经验等。

# 三、产品谱系
3.1 产品总览：以表格列出全部在运作产品（产品名称、备案号、成立日期、托管券商、策略类型）。
3.2 已清算产品：汇总清算产品基本信息，并说明清算比例。
3.3 产品策略分析：归纳主要产品线（如宏观对冲系列、量化系列等），分析策略布局与演进。

# 四、投资业绩
4.1 代表产品业绩表：以表格列出有净值数据的产品最新净值、近1周/1月/3月/6月/1年收益等指标。
4.2 净值走势分析：对有净值历史的代表产品，描述近期净值走势特征，识别最大回撤区间、大涨阶段。
4.3 绩效综合评价：结合收益、风险（回撤）、Sharpe/Calmar等指标作简要综合评价。

# 五、机构发展脉络
以时间轴方式描述公司从成立至今的重要里程碑（首只产品成立、规模突破、产品线扩展等）。

# 六、策略与风险
6.1 核心投资策略分析：依据产品名称、策略分类、基准等信息，推断并描述公司核心策略逻辑。
6.2 风险与关注事项：结合团队规模、产品清算率、规模区间、诚信信息等，列举主要风险点（每条需有依据）。

# 七、综合评估
给出100-200字的综合评价：公司的优势（团队背景、策略稳定性、业绩等）与局限（规模、人员、合规等），以及尽调建议。

---

**要求：**
- 只使用数据库提供的事实数据，不编造任何未提供的信息
- 对于数据库中没有的信息，明确标注"数据暂缺"或"未披露"
- 保持语言专业简洁，适合投研内部传阅
- 表格优先，数字精确，避免模糊表述`
}

// ── SSE handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { managerName?: string; kbPath?: string } = {}
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 })
  }

  const managerName = String(body.managerName ?? "").trim()
  if (!managerName) {
    return new Response(JSON.stringify({ error: "请输入管理人名称" }), { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        try {
          controller.enqueue(encodeEvent(data))
        } catch { /* closed */ }
      }

      // ── Planning ──────────────────────────────────────────────────────
      try {
        emit({ type: "phase", phase: "planning", message: "正在制定调研方案..." })
        const planModel = getChatModel(false)
        const planResp = await withTimeout(
          planModel.invoke([
            new SystemMessage("你是私募基金研究员，擅长管理人尽职调查。"),
            new HumanMessage(
              `用户需要对私募管理人「${managerName}」生成深度调研报告。`
              + `请用不超过100字说明报告编制思路：数据来源（AMAC登记信息、净值数据库）、`
              + `重点关注维度（团队背景、产品业绩、策略分析、风险评估）、报告结构。`,
            ),
          ]),
          15_000,
          null,
        )
        const planText = planResp
          ? (typeof planResp.content === "string" ? planResp.content : JSON.stringify(planResp.content))
          : `将从 AMAC 数据库提取「${managerName}」的登记信息、高管履历、产品备案及净值数据，结合 AI 分析生成深度调研报告。`
        emit({ type: "plan_text", content: planText })
        emit({ type: "plan_done" })
      } catch {
        emit({ type: "plan_text", content: `将从数据库提取「${managerName}」全量数据，生成结构化调研报告。` })
        emit({ type: "plan_done" })
      }

      // ── Step 1: Fetch basic manager info ─────────────────────────────
      emit({ type: "step_start", step: 1, title: "检索 AMAC 管理人登记信息" })
      let data: Awaited<ReturnType<typeof fetchManagerData>> | null = null
      try {
        data = await withTimeout(fetchManagerData(managerName), 30_000, null)
        if (!data) {
          emit({ type: "step_done", step: 1, summary: "数据库查询超时" })
          emit({ type: "error", message: "数据库查询超时，请稍后重试" })
          controller.close()
          return
        }
        const m = data.managers[0]
        emit({
          type: "step_done",
          step: 1,
          summary: m
            ? `找到「${m.manager_name}」，登记编号 ${m.registration_no ?? "—"}，在运作基金 ${m.active_fund_count ?? "—"} 只`
            : `AMAC 数据库中未找到精确匹配「${managerName}」的记录（将继续生成报告）`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 1, summary: `查询出错：${(err as Error).message}` })
        emit({ type: "error", message: `数据库查询失败：${(err as Error).message}` })
        controller.close()
        return
      }

      // ── Step 2: Fetch team & resumes ─────────────────────────────────
      emit({ type: "step_start", step: 2, title: "获取核心团队与履历数据" })
      emit({
        type: "step_done",
        step: 2,
        summary: `核心人员 ${data.executives.length} 名，履历记录 ${data.resumes.length} 条`,
      })

      // ── Step 3: Fetch fund list & performance ────────────────────────
      emit({ type: "step_start", step: 3, title: "获取产品备案与业绩数据" })
      const activeCount = data.funds.filter((f) => f.working_state === "正在运作").length
      const closedCount = data.funds.length - activeCount
      const perfCount = data.perfInfo.filter((p) => p.latest_nav !== null).length
      emit({
        type: "step_done",
        step: 3,
        summary: `共 ${data.funds.length} 只产品（运作中 ${activeCount}，已清算 ${closedCount}），其中 ${perfCount} 只有净值数据`,
      })

      // ── Step 4: Fetch NAV history ────────────────────────────────────
      emit({ type: "step_start", step: 4, title: "获取净值历史数据" })
      const navFundCount = new Set(data.navHistory.map((n) => n.beian_hao)).size
      emit({
        type: "step_done",
        step: 4,
        summary:
          data.navHistory.length > 0
            ? `共 ${data.navHistory.length} 条净值记录，覆盖 ${navFundCount} 只产品`
            : "当前数据库中无该管理人净值历史数据",
      })

      // ── Step 5: Generate report ──────────────────────────────────────
      emit({ type: "step_start", step: 5, title: "AI 生成深度调研报告" })
      try {
        const dataContext = buildDataContext(managerName, data)
        const reportModel = getChatModel(true)
        const reportStream = await reportModel.stream([
          new SystemMessage(
            "你是专业私募基金研究员，请输出规范的 Markdown 调研报告。"
            + "只使用提供的数据，不编造未提供的信息。数据暂缺时明确标注。",
          ),
          new HumanMessage(buildReportPrompt(managerName, dataContext)),
        ])

        let reportLength = 0
        for await (const chunk of reportStream) {
          const delta = typeof chunk.content === "string" ? chunk.content : ""
          if (delta) {
            reportLength += delta.length
            emit({ type: "report_text", delta })
          }
        }

        emit({
          type: "step_done",
          step: 5,
          summary: `报告生成完成，共约 ${reportLength.toLocaleString()} 字`,
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
