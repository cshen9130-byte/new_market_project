import { FUND_DATA_HTTPS_MCP_URL } from "@/lib/ma/fund-data-public"
import { MOM_DATA_HTTPS_MCP_URL } from "@/lib/ma/mom-data-public"

type McpServerEntry = {
  type: "streamable-http"
  url: string
  headers: { "x-api-key": string }
}

/** WorkBuddy mcp.json body. Fund data is always included when that key exists. MOM is added only when the account may use it and already has a MOM key. */
export function buildWorkBuddyMcpConfig(input: {
  fundApiKey: string
  momApiKey: string
  momAccess: boolean
}): string {
  const mcpServers: Record<string, McpServerEntry> = {}
  const fundApiKey = input.fundApiKey.trim()
  const momApiKey = input.momApiKey.trim()
  if (fundApiKey) {
    mcpServers["fund-data"] = {
      type: "streamable-http",
      url: FUND_DATA_HTTPS_MCP_URL,
      headers: { "x-api-key": fundApiKey },
    }
  }
  if (input.momAccess && momApiKey) {
    mcpServers["mom-data"] = {
      type: "streamable-http",
      url: MOM_DATA_HTTPS_MCP_URL,
      headers: { "x-api-key": momApiKey },
    }
  }
  return JSON.stringify({ mcpServers }, null, 2)
}
