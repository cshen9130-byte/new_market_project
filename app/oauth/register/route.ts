import { OAUTH_CORS } from "@/lib/server/mcp-oauth"
import { registerClient } from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "JSON body is required" },
      { status: 400, headers: OAUTH_CORS },
    )
  }
  const result = await registerClient(getMcpOAuthStore(), body)
  if (!result.ok) {
    return Response.json(
      { error: result.error, error_description: result.description },
      { status: result.status, headers: OAUTH_CORS },
    )
  }
  return Response.json(result.body, { status: 201, headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } })
}
