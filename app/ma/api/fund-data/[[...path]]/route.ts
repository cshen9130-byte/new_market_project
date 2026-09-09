import { NextResponse } from "next/server"
import {
  fundDataErr,
  handleFundDataRequest,
  searchParamsToRecord,
} from "@/lib/server/fund-data-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  try {
    const { path } = await params
    const key = (path ?? []).join("/")
    const { searchParams } = new URL(req.url)
    const result = await handleFundDataRequest(key, searchParamsToRecord(searchParams))
    const status = result.error_code === 0 ? 200 : result.error_code === 2 ? 404 : 400
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error("[fund-data]", err)
    return NextResponse.json(fundDataErr(3, "internal error"), { status: 500 })
  }
}
