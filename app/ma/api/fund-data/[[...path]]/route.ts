import { NextResponse } from "next/server"
import { requireFundDataApiUser } from "@/lib/server/fund-data-auth"
import {
  fundDataErr,
  handleFundDataRequest,
  searchParamsToRecord,
} from "@/lib/server/fund-data-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, x-api-key, Authorization",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  try {
    const auth = await requireFundDataApiUser(req)
    if (!auth.ok) {
      return NextResponse.json(auth.body, { status: auth.status, headers: CORS })
    }
    const { path } = await params
    const key = (path ?? []).join("/")
    const { searchParams } = new URL(req.url)
    const result = await handleFundDataRequest(key, searchParamsToRecord(searchParams))
    const status = result.error_code === 0 ? 200 : result.error_code === 2 ? 404 : 400
    return NextResponse.json(result, { status, headers: CORS })
  } catch (err) {
    console.error("[fund-data]", err)
    return NextResponse.json(fundDataErr(3, "internal error"), { status: 500, headers: CORS })
  }
}
