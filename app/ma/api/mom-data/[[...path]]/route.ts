import { NextResponse } from "next/server"
import { requireMomDataApiUser } from "@/lib/server/mom-data-auth"
import {
  handleMomDataRequest,
  momDataErr,
  searchParamsToRecord,
  type MomDataEnvelope,
} from "@/lib/server/mom-data-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, x-api-key, Authorization",
}

function json(result: MomDataEnvelope<unknown>, fallbackStatus = 200) {
  const status = result.error_code === 0
    ? fallbackStatus
    : result.error_code === 2
      ? 404
      : result.error_code === 401
        ? 401
        : result.error_code === 403
          ? 403
          : result.error_code === 3
            ? 500
            : 400
  return NextResponse.json(result, { status, headers: CORS })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  try {
    const auth = await requireMomDataApiUser(req)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status, headers: CORS })
    const { path } = await params
    const key = (path ?? []).join("/")
    if (key === "mcp") {
      return json(momDataErr(1, "MCP is POST /ma/api/mom-data/mcp"))
    }
    const record = searchParamsToRecord(new URL(req.url).searchParams)
    const result = await handleMomDataRequest(key, record)
    return json(result)
  } catch (err) {
    console.error("[mom-data]", err)
    return json(momDataErr(3, "internal error"))
  }
}
