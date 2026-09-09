/**
 * MCP stdio server for internal fund data (FOF99-equivalent tools).
 *
 * Cursor: `.cursor/mcp.json` → fund-data
 * CLI:    pnpm mcp:fund-data
 */

import { loadProjectEnv } from "./load-project-env"

loadProjectEnv()

type JsonRpcId = string | number | null
type JsonRpcReq = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

type ToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const TOOLS: ToolDef[] = [
  {
    name: "fund_search",
    description:
      "Search private funds and managers by 备案号, product name, or manager name. Use this first when the user gives a name instead of a register code.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Name or 备案号, e.g. 幻方 or SR6089" },
        limit: { type: "integer", description: "Max results (1-40, default 8)" },
      },
      required: ["q"],
    },
  },
  {
    name: "fund_info",
    description:
      "FOF99 FundInfo equivalent: basic info for one private fund (name, manager, strategy, fees, latest NAV).",
    inputSchema: {
      type: "object",
      properties: {
        reg_code: { type: "string", description: "备案号, e.g. SR6089" },
      },
      required: ["reg_code"],
    },
  },
  {
    name: "fund_price",
    description:
      "FOF99 FundPrice equivalent: NAV time series for one fund from private_fund_nav.",
    inputSchema: {
      type: "object",
      properties: {
        reg_code: { type: "string", description: "备案号" },
        start_date: { type: "string", description: "YYYY-MM-DD inclusive" },
        end_date: { type: "string", description: "YYYY-MM-DD inclusive" },
        order: { type: "string", description: "1=asc (default), 0=desc" },
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
    description:
      "FOF99 FundMultiPrice equivalent: latest (or on-date) NAV for up to 40 funds.",
    inputSchema: {
      type: "object",
      properties: {
        reg_code: { type: "string", description: "Comma-separated 备案号, max 40" },
        date: { type: "string", description: "YYYY-MM-DD; omit for latest NAV" },
        order: { type: "string", description: "1=asc, 0=desc (default)" },
        order_by: { type: "string", description: "nav|price_date|cumulative_nav|price_change" },
      },
      required: ["reg_code"],
    },
  },
  {
    name: "fund_advanced_list",
    description:
      "FOF99 FundAdvancedList equivalent: paginated fund list filtered by platform/team strategy.",
    inputSchema: {
      type: "object",
      properties: {
        strategy_one: { type: "string", description: "一级策略, 不限 for all" },
        strategy_two: { type: "string", description: "二级策略, default 不限" },
        strategy_three: { type: "string", description: "三级策略, default 不限" },
        type: { type: "integer", description: "1=平台策略 (default), 2=团队策略" },
        fund_state: { type: "integer", description: "1正常运作 2正常清算 3提前清算 4延期清算 5投顾协议已终止 6非正常清算; omit for all" },
        fund_type: { type: "integer", description: "2私募证券 3券商资管 5保险资管 6信托 8公募专户 9期货资管 14资产配置" },
        keyword: { type: "string", description: "Name / 备案号 / manager filter" },
        page: { type: "integer", description: "1-based page, default 1" },
        pagesize: { type: "integer", description: "Max 1000, default 10" },
        order: { type: "string", description: "1=asc, 0=desc (default)" },
        order_by: { type: "string", description: "price_date|inception_date|price_nav|ret_1y|sharpe_1y" },
      },
    },
  },
  {
    name: "fund_view",
    description:
      "FOF99 FundView equivalent: stored performance metrics (ret/sharpe/calmar) for one fund.",
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
    description:
      "FOF99 CompanyInfo equivalent: private-fund manager profile by AMAC registration no or name.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "管理人登记编号, e.g. P1032021" },
        name_cn: { type: "string", description: "管理人名称" },
      },
    },
  },
  {
    name: "company_fund_list",
    description:
      "FOF99 CompanyFundList equivalent: funds managed by one company.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "管理人登记编号" },
        page: { type: "integer" },
        pagesize: { type: "integer" },
        fund_state: { type: "integer", description: "0/omit=all; 1=正常运作, etc." },
      },
      required: ["code"],
    },
  },
]

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
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

function writeMessage(message: unknown): void {
  const json = JSON.stringify(message)
  const payload = Buffer.from(json, "utf8")
  const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8")
  process.stdout.write(Buffer.concat([header, payload]))
}

function okResult(id: JsonRpcId, result: unknown): void {
  if (id === undefined) return
  writeMessage({ jsonrpc: "2.0", id, result })
}

function errResult(id: JsonRpcId, code: number, message: string): void {
  if (id === undefined) return
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } })
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const api = await import("@/lib/server/fund-data-api")
  switch (name) {
    case "fund_search":
      return api.searchFunds(str(args, "q") || "", Number(args.limit) || 8)
    case "fund_info":
      return api.getFundInfo(str(args, "reg_code") || "")
    case "fund_price":
      return api.getFundPrice({
        reg_code: str(args, "reg_code") || "",
        start_date: str(args, "start_date"),
        end_date: str(args, "end_date"),
        order: str(args, "order"),
        order_by: str(args, "order_by"),
      })
    case "fund_multi_price":
      return api.getFundMultiPrice({
        reg_code: str(args, "reg_code") || "",
        date: str(args, "date"),
        order: str(args, "order"),
        order_by: str(args, "order_by"),
      })
    case "fund_advanced_list":
      return api.getFundAdvancedList({
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
      return api.getFundView(str(args, "reg_code") || "")
    case "company_info":
      return api.getCompanyInfo({
        code: str(args, "code"),
        name_cn: str(args, "name_cn"),
        name_short: str(args, "name_short"),
      })
    case "company_fund_list":
      return api.getCompanyFundList({
        code: str(args, "code"),
        page: str(args, "page"),
        pagesize: str(args, "pagesize"),
        fund_state: str(args, "fund_state"),
      })
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

async function handleRequest(msg: JsonRpcReq): Promise<void> {
  const method = String(msg.method ?? "")
  const id = msg.id ?? null
  const isNotification = msg.id === undefined

  if (method === "initialize") {
    okResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fund-data", version: "1.0.0" },
    })
    return
  }
  if (method === "notifications/initialized" || method === "initialized") return
  if (method === "ping") {
    if (!isNotification) okResult(id, {})
    return
  }
  if (method === "tools/list") {
    okResult(id, { tools: TOOLS })
    return
  }
  if (method === "tools/call") {
    const params = asRecord(msg.params)
    const name = String(params.name ?? "")
    const args = asRecord(params.arguments)
    try {
      const data = await callTool(name, args)
      okResult(id, {
        content: [{ type: "text", text: stringify(data) }],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      okResult(id, {
        content: [{ type: "text", text: message }],
        isError: true,
      })
    }
    return
  }

  if (!isNotification) errResult(id, -32601, `Method not found: ${method}`)
}

function parseFrames(buffer: Buffer): { messages: JsonRpcReq[]; rest: Buffer } {
  const messages: JsonRpcReq[] = []
  let rest = buffer
  while (rest.length > 0) {
    const headerEnd = rest.indexOf("\r\n\r\n")
    if (headerEnd !== -1) {
      const header = rest.subarray(0, headerEnd).toString("utf8")
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        rest = rest.subarray(headerEnd + 4)
        continue
      }
      const length = parseInt(match[1], 10)
      const start = headerEnd + 4
      if (rest.length < start + length) break
      const body = rest.subarray(start, start + length).toString("utf8")
      rest = rest.subarray(start + length)
      try {
        messages.push(JSON.parse(body) as JsonRpcReq)
      } catch (err) {
        process.stderr.write(`[fund-data-mcp] invalid json: ${err}\n`)
      }
      continue
    }

    const newline = rest.indexOf(0x0a)
    if (newline === -1) break
    const line = rest.subarray(0, newline).toString("utf8").replace(/\r$/, "").trim()
    rest = rest.subarray(newline + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line) as JsonRpcReq)
    } catch {
      // incomplete JSON; put the line back with remaining bytes
      rest = Buffer.concat([Buffer.from(`${line}\n`, "utf8"), rest])
      break
    }
  }
  return { messages, rest }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    process.stderr.write("[fund-data-mcp] DATABASE_URL is not set; load .env.local or .env\n")
  }
  process.stderr.write("[fund-data-mcp] listening on stdio\n")

  let buffer = Buffer.alloc(0)
  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    const parsed = parseFrames(buffer)
    buffer = parsed.rest
    for (const msg of parsed.messages) {
      void handleRequest(msg).catch((err) => {
        process.stderr.write(`[fund-data-mcp] ${err}\n`)
        if (msg.id !== undefined) {
          errResult(msg.id ?? null, -32603, err instanceof Error ? err.message : String(err))
        }
      })
    }
  })
  process.stdin.on("end", () => process.exit(0))
  process.stdin.resume()
}

void main()
