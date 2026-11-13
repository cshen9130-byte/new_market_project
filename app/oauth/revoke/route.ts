import { hashSecret, isOAuthAccessToken, isOAuthRefreshToken, OAUTH_CORS } from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}

export async function POST(req: Request) {
  const contentType = (req.headers.get("content-type") || "").toLowerCase()
  const params = contentType.includes("application/json")
    ? new URLSearchParams(Object.entries((await req.json().catch(() => ({}))) as Record<string, string>).map(([k, v]) => [k, String(v)]))
    : new URLSearchParams(await req.text())
  const token = params.get("token")?.trim() || ""
  const store = getMcpOAuthStore()
  if (token) {
    const record = isOAuthRefreshToken(token)
      ? await store.getTokenByRefreshHash(hashSecret(token))
      : isOAuthAccessToken(token)
        ? await store.getTokenByAccessHash(hashSecret(token))
        : null
    if (record) await store.revokeToken(record.id, Date.now())
  }
  // RFC 7009: always return 200 even if the token is unknown.
  return new Response(null, { status: 200, headers: OAUTH_CORS })
}
