import { handleAccountRiskDataRequest } from "@/lib/server/account-risk-data-api"
import {
  handleMomDataRequest,
  type MomDataEnvelope,
} from "@/lib/server/mom-data-api"

export type McpJsonRpc = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
}

type Tool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const obj = (properties: Record<string, unknown>, required?: string[]) => ({
  type: "object",
  properties,
  ...(required?.length ? { required } : {}),
})

const DATE = { type: "string", description: "YYYY-MM-DD，含当天" }
const ACCOUNT = { type: "string", description: "资金账号，与 /accounts 返回的 account 一致" }

export const MOM_DATA_MCP_TOOLS: Tool[] = [
  {
    name: "mom_accounts",
    description: "列出可查询的 MOM 资金账号。每条含投顾名称、板块、区间，以及最新权益、保证金占用、保证金使用率（保证金占用/客户权益）和结算单风险度。内部账户不会返回。",
    inputSchema: obj({
      q: { type: "string", description: "账号、投顾名称或板块，模糊匹配" },
      limit: { type: "integer", description: "默认 500，最大 2000" },
      offset: { type: "integer", description: "默认 0" },
    }),
  },
  {
    name: "mom_account_daily",
    description: "单账户每日核算。含客户权益、当日净盈亏、累计净盈亏、保证金使用率、风险度、出入金、手续费、平仓盈亏和持仓盈亏。净盈亏 = 当日盈亏 - 手续费 + 权利金收入 - 权利金支出。累计净盈亏从该账户入库首日算起，不受 start_date 截断。",
    inputSchema: obj({
      account: ACCOUNT,
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "1=日期升序（默认），0=降序" },
      limit: { type: "integer", description: "默认 500，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "mom_account_trades",
    description: "单账户成交。market=all 为期货加期权；futures、options 分开；detail 是结算单「成交明细」原表。默认按日期降序。字段保持结算单原文，含资金账户报单编号和资金账户成交编号。",
    inputSchema: obj({
      account: ACCOUNT,
      market: { type: "string", description: "all（默认）、futures、options，或 detail（成交明细原表）" },
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "0=降序（默认），1=升序" },
      limit: { type: "integer", description: "默认 200，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "mom_account_positions",
    description: "单账户持仓。不传 date 时返回最近一个交易日。market=all 为期货加期权；detail 是结算单「持仓明细」原表。含投机套保、交易编码、实际成交日期和期权市值。",
    inputSchema: obj({
      account: ACCOUNT,
      date: { type: "string", description: "YYYY-MM-DD；不传为最近交易日" },
      market: { type: "string", description: "all（默认）、futures、options，或 detail（持仓明细原表）" },
      limit: { type: "integer", description: "默认 500，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "mom_account_closes",
    description: "单账户平仓明细：合约、买卖、开仓价、平仓价、手数、平仓盈亏、开仓日期。默认按日期降序。",
    inputSchema: obj({
      account: ACCOUNT,
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "0=降序（默认），1=升序" },
      limit: { type: "integer", description: "默认 200，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "mom_account_products",
    description: "单账户品种汇总：每个交易日、每个品种的手数、成交额、手续费和平仓盈亏。",
    inputSchema: obj({
      account: ACCOUNT,
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "1=升序（默认），0=降序" },
      limit: { type: "integer", description: "默认 500，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "mom_account_cashflows",
    description: "核算日报里的期货期权账户出入金明细。当日净出入金请看 mom_account_daily 的 cashflow（当日存取合计）。",
    inputSchema: obj({
      account: ACCOUNT,
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "1=升序（默认），0=降序" },
      limit: { type: "integer", description: "默认 200，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "mom_account_orders",
    description: "单账户委托明细：报单编号、时间、合约、方向、开平、投保、价格、委托数量、成交数量、状态、交易所。默认按日期降序。",
    inputSchema: obj({
      account: ACCOUNT,
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "0=降序（默认），1=升序" },
      limit: { type: "integer", description: "默认 200，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "cfmmc_accounts",
    description: "搜索单账户监控中心已导入的资金账号，不包含 MOM 母基金账户。q 可填期货公司、产品名或账号，例如 q=国泰君安期货。拿到 account 后再调用 cfmmc_account_nav。",
    inputSchema: obj({
      q: { type: "string", description: "期货公司、产品名或资金账号，例如 国泰君安期货 或 85121150" },
      company: { type: "string", description: "期货公司，与 q 二选一，例如 国泰君安期货" },
      limit: { type: "integer", description: "默认 500，最大 2000" },
      offset: { type: "integer" },
    }),
  },
  {
    name: "cfmmc_account_nav",
    description: "单账户监控中心结算单的复权净值，和页面「单账户总览」净值曲线同一口径，从 1 复利。用期货公司加资金账号查询，例如 company=国泰君安期货、account=85121150。company 用来核对期货公司或产品名，对不上就报错。不读 MOM 母基金表。",
    inputSchema: obj({
      account: { type: "string", description: "资金账号，例如 85121150" },
      company: { type: "string", description: "期货公司或产品名，例如 国泰君安期货。用来核对账号" },
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "1=日期升序（默认），0=降序" },
      limit: { type: "integer", description: "默认 2000，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "cfmmc_account_daily",
    description: "单账户监控中心的历史每日结算摘要，读 public.cfmmc_daily_summary。含客户权益、当日存取、平仓盈亏、浮动盈亏、手续费、保证金占用、风险度。传 start_date 和 end_date 取区间。",
    inputSchema: obj({
      account: { type: "string", description: "资金账号，例如 85121150" },
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "1=日期升序（默认），0=降序" },
      limit: { type: "integer", description: "默认 500，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "cfmmc_account_positions",
    description: "单账户历史逐日持仓。传 start_date 和 end_date 返回该区间每个交易日的持仓明细：合约、买/卖持仓、开仓价、今结算价、浮动盈亏、实际成交日期。用来还原建仓、加仓、减仓、换月。不传日期时响应只含最近一个交易日，history 给出库内 first_date、last_date、trading_days。单日用 date。翻页看 next_offset。",
    inputSchema: obj({
      account: { type: "string", description: "资金账号" },
      start_date: DATE,
      end_date: DATE,
      date: { type: "string", description: "只要某一个交易日时填 YYYY-MM-DD。查一段历史用 start_date 和 end_date" },
      order: { type: "string", description: "1=日期升序（默认），0=降序" },
      limit: { type: "integer", description: "默认 500，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "cfmmc_account_trades",
    description: "单账户历史成交明细已开放。每笔含合约、成交时间、买/卖、开/平、价格、手数、成交额、手续费、平仓盈亏、实际成交日期。传 start_date 和 end_date 取区间，默认最近的在前。和持仓快照一起用来还原开平仓时点。翻页看 next_offset。",
    inputSchema: obj({
      account: { type: "string", description: "资金账号" },
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "0=降序（默认），1=升序" },
      limit: { type: "integer", description: "默认 200，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "cfmmc_account_closes",
    description: "单账户历史平仓明细已开放。含合约、买/卖、开仓价、平仓价、手数、昨结算、平仓盈亏、原成交序号、实际成交日期。传 start_date 和 end_date 取区间，默认最近的在前。",
    inputSchema: obj({
      account: { type: "string", description: "资金账号" },
      start_date: DATE,
      end_date: DATE,
      order: { type: "string", description: "0=降序（默认），1=升序" },
      limit: { type: "integer", description: "默认 200，最大 2000" },
      offset: { type: "integer" },
    }, ["account"]),
  },
  {
    name: "cfmmc_rows",
    description: "读取单账户监控中心导入写入的 public.cfmmc_*，和 MOM 母基金表分开。dataset 取 accounts、nav、daily、products、positions、trades、closes、cashflows、option-trades、securities。历史逐日持仓、成交、平仓已开放：positions、trades、closes 传 start_date 和 end_date。净值优先用 cfmmc_account_nav，持仓优先用 cfmmc_account_positions，成交优先用 cfmmc_account_trades。除 accounts 外都要 account。",
    inputSchema: obj({
      dataset: { type: "string", description: "accounts、nav、daily、products、positions、trades、closes、cashflows、option-trades、securities" },
      account: { type: "string", description: "资金账号。accounts 可不传。nav 例如 85121150" },
      company: { type: "string", description: "仅 nav：期货公司，例如 国泰君安期货，用来核对账号" },
      start_date: DATE,
      end_date: DATE,
      date: { type: "string", description: "只要某一个交易日时填 YYYY-MM-DD。历史区间用 start_date 和 end_date。positions 三个都不传时才返回最近一个交易日，响应 history 里有库内首尾日期" },
      order: { type: "string", description: "1=升序，0=降序。成交和平仓默认降序" },
      limit: { type: "integer", description: "最大 2000" },
      offset: { type: "integer" },
      q: { type: "string", description: "accounts：期货公司、产品名或账号。nav：可代替 company" },
    }, ["dataset"]),
  },
  {
    name: "mom_account_metrics",
    description: "用已入库的每日核算计算区间指标：总净盈亏、胜率、盈亏比、年化波动、夏普（无风险利率 0）、客户权益最大回撤、保证金使用率（最新/均值/P10/P90/最大），以及 1 日历史 VaR 与 CVaR（95% 和 99%）。日收益率 = 当日净盈亏 / 上一日客户权益。样本少于 20 个日收益率时 VaR 为空。这是历史模拟，不是持仓参数法 VaR。",
    inputSchema: obj({
      account: ACCOUNT,
      start_date: DATE,
      end_date: DATE,
    }, ["account"]),
  },
]

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function callTool(name: string, args: Record<string, unknown>): Promise<MomDataEnvelope<unknown>> {
  const record: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value != null && value !== "") record[key] = String(value)
  }
  switch (name) {
    case "mom_accounts":
      return handleMomDataRequest("accounts", record)
    case "mom_account_daily":
      return handleMomDataRequest("account/daily", record)
    case "mom_account_trades":
      return handleMomDataRequest("account/trades", record)
    case "mom_account_positions":
      return handleMomDataRequest("account/positions", record)
    case "mom_account_closes":
      return handleMomDataRequest("account/closes", record)
    case "mom_account_products":
      return handleMomDataRequest("account/products", record)
    case "mom_account_cashflows":
      return handleMomDataRequest("account/cashflows", record)
    case "mom_account_orders":
      return handleMomDataRequest("account/orders", record)
    case "mom_account_metrics":
      return handleMomDataRequest("account/metrics", record)
    case "cfmmc_accounts":
      return handleAccountRiskDataRequest("accounts", record)
    case "cfmmc_account_nav":
      return handleAccountRiskDataRequest("account/nav", record)
    case "cfmmc_account_daily":
      return handleAccountRiskDataRequest("account/daily", record)
    case "cfmmc_account_positions":
      return handleAccountRiskDataRequest("account/positions", record)
    case "cfmmc_account_trades":
      return handleAccountRiskDataRequest("account/trades", record)
    case "cfmmc_account_closes":
      return handleAccountRiskDataRequest("account/closes", record)
    case "cfmmc_rows": {
      const dataset = (record.dataset ?? "").trim()
      delete record.dataset
      const path = dataset === "accounts" ? "accounts" : dataset ? `account/${dataset}` : ""
      return handleAccountRiskDataRequest(path, record)
    }
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

export async function handleMomDataMcpRpc(msg: McpJsonRpc): Promise<Record<string, unknown> | null> {
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
        serverInfo: { name: "mom-data", version: "1.0.0" },
      },
    }
  }
  if (method === "notifications/initialized" || method === "initialized") return null
  if (method === "ping") {
    if (isNotification) return null
    return { jsonrpc: "2.0", id: id ?? null, result: {} }
  }
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        tools: MOM_DATA_MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
    }
  }
  if (method === "tools/call") {
    const params = asRecord(msg.params)
    const name = String(params.name ?? "")
    const args = asRecord(params.arguments)
    try {
      const data = await callTool(name, args)
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          isError: data.error_code !== 0,
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
