import { handleTokenGrant, OAUTH_CORS } from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}

async function readParams(req: Request): Promise<URLSearchParams> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(body)) {
      if (value != null) params.set(key, String(value))
    }
    return params
  }
  const text = await req.text()
  return new URLSearchParams(text)
}

export async function POST(req: Request) {
  const params = await readParams(req)
  const result = await handleTokenGrant(getMcpOAuthStore(), params, req.headers.get("authorization"))
  if (!result.ok) {
    const headers: Record<string, string> = { ...OAUTH_CORS, "Cache-Control": "no-store" }
    if (result.status === 401) headers["WWW-Authenticate"] = 'Basic realm="MA OAuth"'
    return Response.json(
      { error: result.error, error_description: result.description },
      { status: result.status, headers },
    )
  }
  return Response.json(result.tokens, { headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } })
}
