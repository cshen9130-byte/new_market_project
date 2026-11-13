import { originFromRequest, OAUTH_CORS, protectedResourceMetadata } from "@/lib/server/mcp-oauth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}

export async function GET(req: Request) {
  const origin = originFromRequest(req)
  // Root document points at the fund-data MCP; path-specific documents are preferred.
  return Response.json(protectedResourceMetadata(origin, "/ma/api/fund-data/mcp"), {
    headers: { ...OAUTH_CORS, "Cache-Control": "no-store" },
  })
}
