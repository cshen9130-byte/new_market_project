import crypto from "crypto"
import { isYingmiQuotaMessage, type YingmiMetric, type YingmiStrategyRef } from "@/lib/ma/yingmi-private-fund"

export const YINGMI_MCP_RESOURCE = "https://stargate-partner.yingmi.com/mcp/v2/oauth/qieman"
const OAUTH_BASE = "https://stargate-partner.yingmi.com"
export const YINGMI_OAUTH_SCOPE = "openid offline_access oapqieman:level1 oapqieman:level2 oapqieman:level3"

export class YingmiQuotaError extends Error {
  constructor(message = "今日请求次数已达上限") {
    super(message)
    this.name = "YingmiQuotaError"
  }
}

export function yingmiRedirectUri(req: Request): string {
  const configured = process.env.YINGMI_OAUTH_REDIRECT_URI?.trim()
  if (configured) return configured
  return `${requestOrigin(req)}/ma/api/yingmi-private-funds/callback`
}

export function requestOrigin(req: Request): string {
  const url = new URL(req.url)
  const proto = headerFirst(req, "x-forwarded-proto") || url.protocol.replace(":", "")
  const host = headerFirst(req, "x-forwarded-host") || headerFirst(req, "host") || url.host
  return `${proto}://${host}`
}

function headerFirst(req: Request, name: string): string {
  return (req.headers.get(name) || "").split(",")[0].trim()
}

export async function registerYingmiClient(redirectUri: string): Promise<string> {
  const res = await fetch(`${OAUTH_BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "market-dashboard",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: YINGMI_OAUTH_SCOPE,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`盈米注册客户端失败 (${res.status})`)
  const clientId = JSON.parse(text).client_id
  if (typeof clientId !== "string" || !clientId) throw new Error("盈米没有返回 client_id")
  return clientId
}

export function yingmiAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    scope: YINGMI_OAUTH_SCOPE,
    state: input.state,
    resource: YINGMI_MCP_RESOURCE,
  })
  return `${OAUTH_BASE}/oauth/authorize?${params.toString()}`
}

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = crypto.randomBytes(32).toString("base64url")
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
  const state = crypto.randomBytes(16).toString("hex")
  return { verifier, challenge, state }
}

type TokenBundle = { accessToken: string; refreshToken: string | null }

export async function exchangeYingmiCode(input: {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
}): Promise<TokenBundle> {
  return requestToken({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
    resource: YINGMI_MCP_RESOURCE,
  })
}

export async function refreshYingmiAccess(input: { clientId: string; refreshToken: string }): Promise<TokenBundle> {
  return requestToken({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    resource: YINGMI_MCP_RESOURCE,
  })
}

async function requestToken(fields: Record<string, string>): Promise<TokenBundle> {
  const res = await fetch(`${OAUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  })
  const text = await res.text()
  if (!res.ok) throw new Error("盈米授权刷新失败，请在页面上重新连接")
  const json = JSON.parse(text) as { access_token?: string; refresh_token?: string }
  if (!json.access_token) throw new Error("盈米没有返回 access_token")
  return { accessToken: json.access_token, refreshToken: json.refresh_token || null }
}

export async function callYingmiTool(accessToken: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(YINGMI_MCP_RESOURCE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  })
  const raw = await res.text()
  if (isYingmiQuotaMessage(raw)) throw new YingmiQuotaError(quotaLine(raw))
  if (!res.ok) throw new Error(`盈米 MCP 请求失败 (${res.status})`)
  return parseToolBody(raw)
}

function quotaLine(raw: string): string {
  try {
    const json = JSON.parse(raw) as { error?: { message?: string } }
    if (json.error?.message) return json.error.message
  } catch {
    // body is not JSON
  }
  return "今日请求次数已达上限"
}

export function parseToolBody(raw: string): unknown {
  const payload = raw.trim().startsWith("{") ? raw : sseData(raw)
  const outer = JSON.parse(payload) as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } }
  if (outer.error?.message) {
    if (isYingmiQuotaMessage(outer.error.message)) throw new YingmiQuotaError(outer.error.message)
    throw new Error(outer.error.message)
  }
  const text = outer.result?.content?.find((item) => item.text)?.text
  if (!text) return outer
  if (isYingmiQuotaMessage(text)) throw new YingmiQuotaError(quotaLine(text))
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

function sseData(raw: string): string {
  const chunks = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
  if (!chunks.length) throw new Error("盈米 MCP 没有返回数据")
  return chunks[chunks.length - 1]
}

export function searchArguments(input: {
  strategy: YingmiStrategyRef
  metrics?: YingmiMetric[]
  companyName?: string
}): Record<string, unknown> {
  const strategy: Record<string, unknown> = { level: input.strategy.level, name: input.strategy.name }
  if (input.strategy.level1Name) strategy.level1Name = input.strategy.level1Name
  if (input.strategy.level2Name) strategy.level2Name = input.strategy.level2Name
  const args: Record<string, unknown> = { strategy, limit: 20 }
  if (input.metrics?.length) args.metrics = input.metrics
  if (input.companyName) args.companyName = input.companyName
  return args
}
