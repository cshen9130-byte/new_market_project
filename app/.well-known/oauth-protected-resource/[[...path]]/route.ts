import { originFromRequest, OAUTH_CORS, protectedResourceMetadata, resourceFamily } from "@/lib/server/mcp-oauth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS })
}

export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const origin = originFromRequest(req)
  const { path = [] } = await ctx.params
  const resourcePath = `/${path.join("/")}`
  const family = resourceFamily(`${origin}${resourcePath}`)
  const normalized =
    family === "mom-data" ? "/ma/api/mom-data/mcp" :
    family === "fund-data" ? "/ma/api/fund-data/mcp" :
    resourcePath
  return Response.json(protectedResourceMetadata(origin, normalized), {
    headers: { ...OAUTH_CORS, "Cache-Control": "no-store" },
  })
}
