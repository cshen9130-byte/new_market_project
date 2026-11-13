import { credentialFailureDescription, OAUTH_CORS, originFromRequest, resolveAccessToken, unauthorizedHeaders } from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"
import { getUserById } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || ""
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  const origin = originFromRequest(req)
  if (!token) {
    return Response.json(
      { error: "invalid_token", error_description: "access token is required" },
      { status: 401, headers: { ...OAUTH_CORS, ...unauthorizedHeaders(origin, "fund-data", "invalid_request", "access token is required") } },
    )
  }
  // Userinfo is issued after a login to either MCP; accept either family.
  const store = getMcpOAuthStore()
  const fund = await resolveAccessToken(store, token, "fund-data", getUserById)
  const mom = fund.ok ? fund : await resolveAccessToken(store, token, "mom-data", getUserById)
  const resolved = fund.ok ? fund : mom
  if (!resolved.ok) {
    return Response.json(
      { error: "invalid_token", error_description: credentialFailureDescription(resolved.reason) },
      { status: 401, headers: { ...OAUTH_CORS, ...unauthorizedHeaders(origin, "fund-data", "invalid_token", credentialFailureDescription(resolved.reason)) } },
    )
  }
  return Response.json(
    {
      sub: resolved.user.id,
      name: resolved.user.name,
      email: resolved.user.email,
      preferred_username: resolved.user.name,
    },
    { headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } },
  )
}
