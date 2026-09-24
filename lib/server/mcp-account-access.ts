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
      "查询跟踪池中单只产品的完整信息：策略分级、策略标签、个人标签、开放日、管理费、业绩报酬、赎回费、净值与收益，以及团队笔记和个人笔记。",
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
    description: "同策略对比分析。传入多只基金名称或备案号，生成对比研究报告。",
    inputSchema: obj({
      subjects: {
        type: "array",
        items: { type: "string" },
        description: "基金名称或备案号，至少 1 个",
      },
      kb_path: { type: "string", description: "知识库文件夹相对路径，空为全库" },
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
    description: "列出 AI 知识库中当前账户可见的文件夹和文件。",
    inputSchema: obj({
      path: { type: "string", description: "文件夹相对路径，空为根目录" },
      limit: { type: "integer", description: "最多返回条数，默认 200，最大 400" },
    }),
  },
  {
    name: "kb_read",
    area: "knowledge",
    description: "读取知识库中一个文件的文本内容。",
    inputSchema: obj({
      path: { type: "string", description: "文件相对路径" },
    }, ["path"]),
  },
  {
    name: "kb_ask",
    area: "knowledge",
    description: "基于 AI 知识库回答问题，返回回答与引用文件。",
    inputSchema: obj({
      question: { type: "string" },
      folder_path: { type: "string", description: "限定文件夹，空为全库" },
      file_path: { type: "string", description: "只针对一个文件提问" },
    }, ["question"]),
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
