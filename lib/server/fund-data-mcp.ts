import {
  getCompanyFundList,
  getCompanyInfo,
  getFundAdvancedList,
  getFundInfo,
  getFundMultiPrice,
  getFundPrice,
  getFundView,
  searchFunds,
} from "@/lib/server/fund-data-api"

export type FundDataMcpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const FUND_DATA_MCP_TOOLS: FundDataMcpTool[] = [
  {
    name: "fund_search",
    description: "按备案号、产品名称或管理人名称搜索私募基金与管理人。名称未知时先用这个。",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "名称或备案号" },
        limit: { type: "integer", description: "1–40，默认 8" },
      },
      required: ["q"],
    },
  },
  {
    name: "fund_info",
    description: "查询单只私募基金基本信息（名称、管理人、策略、申赎要素、最新净值）。",
    inputSchema: {
      type: "object",
      properties: {
        reg_code: { type: "string", description: "备案号" },
      },
      required: ["reg_code"],
    },
  },
  {
    name: "fund_price",
    description: "查询单只基金净值时间序列。",
    inputSchema: {
      type: "object",
      properties: {
        reg_code: { type: "string", description: "备案号" },
        start_date: { type: "string", description: "YYYY-MM-DD，含当天" },
        end_date: { type: "string", description: "YYYY-MM-DD，含当天" },
        order: { type: "string", description: "1=升序（默认），0=降序" },
        order_by: {
          type: "string",
          description: "price_date|nav|cumulative_nav|cumulative_nav_withdrawal|price_change",
        },
      },
      required: ["reg_code"],
    },
  },
  {
    name: "fund_multi_price",
    description: "一次查询最多 40 只基金在指定日期（或不传则最新）的净值。",
    inputSchema: {
      type: "object",
      properties: {
        reg_code: { type: "string", description: "逗号分隔备案号，最多 40 个" },
        date: { type: "string", description: "YYYY-MM-DD；不传为最新净值" },
        order: { type: "string", description: "1=升序，0=降序（默认）" },
        order_by: { type: "string", description: "nav|price_date|cumulative_nav|price_change" },
      },
      required: ["reg_code"],
    },
  },
  {
    name: "fund_advanced_list",
    description: "按平台/团队策略、基金类型、运作状态分页查询基金列表。",
    inputSchema: {
      type: "object",
      properties: {
        strategy_one: { type: "string", description: "一级策略，不限表示全部" },
        strategy_two: { type: "string", description: "二级策略" },
        strategy_three: { type: "string", description: "三级策略" },
        type: { type: "integer", description: "1=平台策略（默认），2=团队策略" },
        fund_state: { type: "integer", description: "1正常运作 2正常清算 3提前清算 4延期清算 5投顾协议已终止 6非正常清算；不传=全部" },
        fund_type: { type: "integer", description: "2私募证券 3券商资管 5保险资管 6信托 8公募专户 9期货资管 14资产配置" },
        keyword: { type: "string", description: "产品名 / 备案号 / 管理人" },
        page: { type: "integer", description: "从 1 开始，默认 1" },
        pagesize: { type: "integer", description: "默认 10，最大 1000" },
        order: { type: "string", description: "1=升序，0=降序（默认）" },
        order_by: { type: "string", description: "price_date|inception_date|price_nav|ret_1y|sharpe_1y" },
      },
    },
  },
  {
    name: "fund_view",
    description: "查询单只基金业绩指标（区间收益、夏普、卡玛）。",
    inputSchema: {
      type: "object",
      properties: {
        reg_code: { type: "string", description: "备案号" },
      },
      required: ["reg_code"],
    },
  },
  {
    name: "company_info",
    description: "按管理人登记编号或名称查询管理人信息。",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "管理人登记编号，如 P1032021" },
        name_cn: { type: "string", description: "管理人名称" },
      },
    },
  },
  {
    name: "company_fund_list",
    description: "查询某管理人旗下基金列表。",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "管理人登记编号" },
        page: { type: "integer" },
        pagesize: { type: "integer" },
        fund_state: { type: "integer", description: "0或不传=全部；1=正常运作 等" },
      },
      required: ["code"],
    },
  },
]

export type McpJsonRpc = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value == null) return undefined
  return String(value)
}

export async function callFundDataTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "fund_search":
      return searchFunds(str(args, "q") || "", Number(args.limit) || 8)
    case "fund_info":
      return getFundInfo(str(args, "reg_code") || "")
    case "fund_price":
      return getFundPrice({
        reg_code: str(args, "reg_code") || "",
        start_date: str(args, "start_date"),
        end_date: str(args, "end_date"),
        order: str(args, "order"),
        order_by: str(args, "order_by"),
      })
    case "fund_multi_price":
      return getFundMultiPrice({
        reg_code: str(args, "reg_code") || "",
        date: str(args, "date"),
        order: str(args, "order"),
        order_by: str(args, "order_by"),
      })
    case "fund_advanced_list":
      return getFundAdvancedList({
        strategy_one: str(args, "strategy_one"),
        strategy_two: str(args, "strategy_two"),
        strategy_three: str(args, "strategy_three"),
        type: str(args, "type"),
        page: str(args, "page"),
        pagesize: str(args, "pagesize"),
        order: str(args, "order"),
        order_by: str(args, "order_by"),
        fund_state: str(args, "fund_state"),
        fund_type: str(args, "fund_type"),
        keyword: str(args, "keyword"),
      })
    case "fund_view":
      return getFundView(str(args, "reg_code") || "")
    case "company_info":
      return getCompanyInfo({
        code: str(args, "code"),
        name_cn: str(args, "name_cn"),
        name_short: str(args, "name_short"),
      })
    case "company_fund_list":
      return getCompanyFundList({
        code: str(args, "code"),
        page: str(args, "page"),
        pagesize: str(args, "pagesize"),
        fund_state: str(args, "fund_state"),
      })
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

/** JSON-RPC result body, or null for notifications (no response). */
export async function handleFundDataMcpRpc(
  msg: McpJsonRpc,
): Promise<Record<string, unknown> | null> {
  const method = String(msg.method ?? "")
  const id = msg.id
  const isNotification = id === undefined

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fund-data", version: "1.0.0" },
      },
    }
  }
  if (method === "notifications/initialized" || method === "initialized") return null
  if (method === "ping") {
    if (isNotification) return null
    return { jsonrpc: "2.0", id: id ?? null, result: {} }
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id: id ?? null, result: { tools: FUND_DATA_MCP_TOOLS } }
  }
  if (method === "tools/call") {
    const params = asRecord(msg.params)
    const name = String(params.name ?? "")
    const args = asRecord(params.arguments)
    try {
      const data = await callFundDataTool(name, args)
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          content: [{ type: "text", text: message }],
          isError: true,
        },
      }
    }
  }

  if (isNotification) return null
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method}` },
  }
}
