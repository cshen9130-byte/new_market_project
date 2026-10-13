import type { User } from "@/lib/auth"
import {
  canAccessAiKnowledge,
  canAccessAiResearcher,
  canAccessPfInvestmentPool,
  canAccessPfInvestmentTracking,
} from "@/lib/permissions"
import type { StoredUser } from "@/lib/server/users"

/** API-key user attached to a fund-data MCP request. */
export type McpAccount = Omit<StoredUser, "passwordHash">

export type McpArea = "tracking" | "managed" | "researcher" | "knowledge"

export const MCP_AREA_LABEL: Record<McpArea, string> = {
  tracking: "跟踪池",
  managed: "在管产品",
  researcher: "AI研究员",
  knowledge: "AI知识库",
}

export type AccountMcpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  area: McpArea
}

const obj = (properties: Record<string, unknown>, required?: string[]) => ({
  type: "object",
  properties,
  ...(required?.length ? { required } : {}),
})

export const ACCOUNT_MCP_TOOLS: AccountMcpTool[] = [
  {
    name: "tracking_pools",
    area: "tracking",
    description: "列出当前账户可见的跟踪池（团队池与我的跟踪）。隐藏池不会返回。",
    inputSchema: obj({}),
  },
  {
    name: "tracking_pool_list",
    area: "tracking",
    description:
      "查询跟踪池产品列表，字段与投资页跟踪池一致，并附带策略标签、个人标签、开放日和费率。默认池为全部。",
    inputSchema: obj({
      pool: {
        type: "string",
        description: "池 key。all=全部（默认），jy=JY跟踪池，jy_ops=JY运维池，hy、selected、core、fof，或 tracking_pools 返回的自定义 key",
      },
      keyword: { type: "string", description: "产品名、简称或备案号" },
      strategy_source: { type: "string", description: "company=团队策略（默认），platform=平台策略" },
      strategy_l1: { type: "string", description: "一级策略，不传表示不限" },
      strategy_l2: { type: "string", description: "二级策略" },
      strategy_l3: { type: "string", description: "三级策略" },
      team_tag: { type: "string", description: "策略标签，多个用英文逗号分隔" },
      team_tag_mode: { type: "string", description: "and（默认）或 or" },
      page: { type: "integer", description: "从 1 开始，默认 1" },
      page_size: { type: "integer", description: "默认 20，最大 50" },
    }),
  },
  {
    name: "tracking_pool_detail",
    area: "tracking",
    description:
      "查询跟踪池中单只产品的完整信息：策略分级、策略标签、个人标签、开放日、费率、净值与收益，以及跟踪池上的团队短备注（team_note）和个人短备注（personal_note）。这不是知识库里的长文「投资笔记」；长文请用 kb_ask，folder_path 填「投资笔记」。",
    inputSchema: obj(
      {
        reg_code: { type: "string", description: "备案号" },
        name: { type: "string", description: "产品名称；备案号未知时使用" },
        pool: { type: "string", description: "限定在某个池内查找，默认 all" },
      },
    ),
  },
  {
    name: "managed_products_list",
    area: "managed",
    description:
      "查询在管产品。仅当账户拥有投资池权限（在管产品）时可用。返回策略分级、策略标签、净值、规模、托管余额、开放日和费率。",
    inputSchema: obj({
      keyword: { type: "string", description: "产品名或备案号" },
      strategy_source: { type: "string", description: "company（默认）或 platform" },
      strategy_l1: { type: "string" },
      strategy_l2: { type: "string" },
      strategy_l3: { type: "string" },
      team_tag: { type: "string", description: "策略标签，逗号分隔" },
      team_tag_mode: { type: "string", description: "and（默认）或 or" },
      run_status: { type: "string", description: "running（默认，在运作）或 liquidated 或 all" },
      page: { type: "integer" },
      page_size: { type: "integer", description: "默认 20，最大 50" },
    }),
  },
  {
    name: "ai_researcher_compare",
    area: "researcher",
    description:
      "对比多只基金。先按与 fund_search、fund_info 相同的规则绑定备案号，并先返回 bindings（备案号、名称、匹配方式、是否有净值）。任一对象未绑定则 resolved 为 false、report 为 null，不会用投资笔记编造业绩。绑定成功后 funds 里是 fund_view 的净值、收益、夏普、卡玛；incomplete_windows 标出成立时间不够的区间。same_strategy 为 false 时只分组，不做同策略排序。名称带「C类」会绑到母基金，nav_scope 为 parent 表示公布净值不是该类单独净值。投资笔记只保留正文点名该基金的段落。",
    inputSchema: obj({
      subjects: {
        type: "array",
        items: { type: "string" },
        description: "基金名称或备案号，至少 2 个。名称以 A类/B类/C类 结尾时绑定母基金。备案号整段精确匹配。",
      },
      kb_path: {
        type: "string",
        description: "可选。填「投资笔记」时只在该文件夹查找。只保留正文点名该基金的段落，不会用无关笔记填业绩。",
      },
    }, ["subjects"]),
  },
  {
    name: "ai_researcher_similar",
    area: "researcher",
    description: "相似基金匹配。按一只基金（名称或备案号）从全库匹配最相似产品并生成报告。",
    inputSchema: obj({
      subject: { type: "string", description: "基金名称" },
      reg_code: { type: "string", description: "备案号" },
      kb_path: { type: "string" },
      file_note: { type: "string", description: "补充说明" },
    }),
  },
  {
    name: "ai_researcher_opposite",
    area: "researcher",
    description: "相反基金匹配。找出与目标基金净值负相关的产品并生成对冲分析。",
    inputSchema: obj({
      subject: { type: "string", description: "基金名称" },
      reg_code: { type: "string", description: "备案号" },
      kb_path: { type: "string" },
    }),
  },
  {
    name: "ai_researcher_roadshow",
    area: "researcher",
    description: "路演漏洞扫描。针对知识库中的路演或月报材料生成尽调风险报告。",
    inputSchema: obj({
      kb_path: { type: "string", description: "知识库中路演材料的相对路径" },
      reg_code: { type: "string", description: "可选，关联的基金备案号" },
    }, ["kb_path"]),
  },
  {
    name: "ai_researcher_team_background",
    area: "researcher",
    description: "团队背景筛选。按前任机构关键词（如 高盛、中金）检索管理人并生成报告。",
    inputSchema: obj({
      keyword: { type: "string", description: "机构或背景关键词" },
      kb_path: { type: "string" },
    }, ["keyword"]),
  },
  {
    name: "ai_researcher_manager_profile",
    area: "researcher",
    description: "管理人深度画像。按私募管理人名称生成登记、团队、产品与业绩报告。",
    inputSchema: obj({
      manager_name: { type: "string", description: "管理人名称" },
      kb_path: { type: "string" },
    }, ["manager_name"]),
  },
  {
    name: "kb_list",
    area: "knowledge",
    description: "列出 AI 知识库中当前账户可见的文件夹和文件。团队投资笔记在文件夹「投资笔记」下。根目录列举会在 400 条处停住，找点睛业绩榜请传 q，例如「点睛 930」，会在全库按文件名搜索。",
    inputSchema: obj({
      path: { type: "string", description: "文件夹相对路径。列投资笔记填「投资笔记」，空为根目录" },
      q: { type: "string", description: "按文件名搜索，空格分开的词都要出现。例：点睛 930。不受根目录 400 条截断影响" },
      limit: { type: "integer", description: "最多返回条数，默认 200，最大 400" },
    }),
  },
  {
    name: "kb_read",
    area: "knowledge",
    description: "读取知识库中一个文件。xlsx 返回 sheets：每张表有 sheet、headers、rows（一行一个对象），另有按行排列的 text。不会把整张表收成一行。行数放不下时 truncated 为 true，并给出 next_row，截断发生在整行边界。path 来自 kb_list 或 kb_list 的 q 搜索。",
    inputSchema: obj({
      path: { type: "string", description: "文件相对路径，如 投资笔记/某产品投资笔记.html" },
    }, ["path"]),
  },
  {
    name: "kb_search",
    area: "knowledge",
    description:
      "检索 AI 知识库，只返回命中片段、相关度、文件路径和页码，不生成回答。人名或路演问题会按路径把对应笔记排到前面。片段里没有答案、且 suggest_full_read 为 true 时，再用 kb_read 读该文件。",
    inputSchema: obj({
      question: { type: "string", description: "检索问题。例：左广东看多的品种都有哪些？" },
      folder_path: { type: "string", description: "限定文件夹。空为全库" },
      file_path: { type: "string", description: "只在一个文件里检索" },
      limit: { type: "integer", description: "最多返回条数，默认 8，最大 20" },
    }, ["question"]),
  },
  {
    name: "kb_ask",
    area: "knowledge",
    description:
      "基于 AI 知识库回答问题。人名、路演、观点类问题会优先读路径命中的短文件全文。点睛等业绩榜问「最高 / 前 N / 某一列」时，服务端解析 xlsx 后按该列排序再回答，ranking.sort_key 是排序列，与文件名里的「今年来」不是同一排序。填表时 question 写成「列：「量道」，行：「代表产品」」，不要传 folder_path，否则只搜一个文件夹。没有段落出现列名时 value 为「暂无数据」，sources 为空。列名出现时返回 value，以及 sources（path、quote，quote 含列名）。文件名含列名且文件较短时会整篇读入。默认模型 qwen-plus。只要片段不要回答时用 kb_search。",
    inputSchema: obj({
      question: { type: "string", description: "问题。例：左广东看多的品种都有哪些？只根据路演笔记原文回答" },
      folder_path: { type: "string", description: "限定文件夹。投资笔记填「投资笔记」。空为全库" },
      file_path: { type: "string", description: "只针对一个文件提问，如 投资笔记/某产品投资笔记.html" },
      model: { type: "string", description: "plus（默认）、turbo 或 max。抽取事实用 plus，不要用 turbo" },
      debug: { type: "boolean", description: "为 true 时额外返回 passages：检索片段、分数、路径和页码" },
    }, ["question"]),
  },
  {
    name: "external_rank_compare",
    area: "tracking",
    description:
      "把知识库里的外部业绩榜（点睛等 xlsx，按管理人或产品）和跟踪池同一策略的产品对比。收益按榜单自己的截止日期，用净值库重算今年以来或近一年，不读取周度回顾 Excel。返回 both（两边都有）、external_only（榜上有、池子没有，可当候选）、pool_only（池子有、榜单前 N 没有）、needs_review（名称接近但未自动匹配，不要当成已匹配）。收益是百分数，159.12 表示 159.12%。需要投资页权限；调用时还会检查 AI 知识库权限。",
    inputSchema: obj({
      class: {
        type: "string",
        description: "策略。主观多头、量化股票、量化CTA、主观CTA，或具体分组如 500指增。一份文件里只有一种策略时可以不填",
      },
      file_path: {
        type: "string",
        description: "知识库相对路径。不填则在全库选择该策略最新的点睛/业绩榜 xlsx。文件名请保留「点睛」或「业绩榜」",
      },
      pools: {
        type: "string",
        description: "jy（默认，JY跟踪池）、selected（JY精选池），或 jy,selected",
      },
      week_end: {
        type: "string",
        description: "可选，YYYY-MM-DD。只用来提示和榜单截止日差多少天，收益仍按榜单截止日计算",
      },
      top_n: {
        type: "integer",
        description: "只筛榜单前 N 名。默认 30，最大 100",
      },
    }),
  },
]

const TOOL_AREA = new Map(ACCOUNT_MCP_TOOLS.map((tool) => [tool.name, tool.area]))

export function mcpAccountArea(toolName: string): McpArea | null {
  return TOOL_AREA.get(toolName) ?? null
}

function asPageUser(account: McpAccount): User {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    permissions: account.permissions,
  }
}

/** Same page gates as the website. Admin can use every area. */
export function canUseMcpArea(account: McpAccount | null | undefined, area: McpArea): boolean {
  if (!account) return false
  const user = asPageUser(account)
  switch (area) {
    case "tracking":
      return canAccessPfInvestmentTracking(user)
    case "managed":
      return canAccessPfInvestmentPool(user)
    case "researcher":
      return canAccessAiResearcher(user)
    case "knowledge":
      return canAccessAiKnowledge(user)
  }
}

export function accountToolsFor(account: McpAccount | null | undefined): AccountMcpTool[] {
  return ACCOUNT_MCP_TOOLS.filter((tool) => canUseMcpArea(account, tool.area))
}

export function mcpAreaDeniedMessage(area: McpArea): string {
  const label = MCP_AREA_LABEL[area]
  return `当前账户没有「${label}」权限，无法通过 MCP 访问。MCP 与网页使用同一套账户权限。`
}
