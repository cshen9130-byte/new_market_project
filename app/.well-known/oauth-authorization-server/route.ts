import { authorizationServerMetadata, originFromRequest, OAUTH_CORS } from "@/lib/server/mcp-oauth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}

export async function GET(req: Request) {
  const issuer = originFromRequest(req)
  return Response.json(authorizationServerMetadata(issuer), {
    headers: { ...OAUTH_CORS, "Cache-Control": "no-store" },
  })
}
