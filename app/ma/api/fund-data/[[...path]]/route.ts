import { NextResponse } from "next/server"
import { requireFundDataApiUser } from "@/lib/server/fund-data-auth"
import {
  fundDataErr,
  handleFundDataRequest,
  searchParamsToRecord,
  type FundDataEnvelope,
} from "@/lib/server/fund-data-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, x-api-key, Authorization",
}

function fundDataResponse(result: FundDataEnvelope<unknown>, format: string | undefined) {
  const status = result.error_code === 0 ? 200 : result.error_code === 2 ? 404 : 400
  if (format === "ndjson" && result.error_code === 0 && result.data && typeof result.data === "object") {
    const data = result.data as { series?: unknown[]; next_cursor?: string | null }
    if (Array.isArray(data.series)) {
      const lines = data.series.map((row) => JSON.stringify(row))
      if (data.next_cursor) lines.push(JSON.stringify({ next_cursor: data.next_cursor }))
      return new NextResponse(`${lines.join("\n")}\n`, {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/x-ndjson; charset=utf-8" },
      })
    }
  }
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
    const auth = await requireFundDataApiUser(req)
    if (!auth.ok) {
      return NextResponse.json(auth.body, { status: auth.status, headers: CORS })
    }
    const { path } = await params
    const key = (path ?? []).join("/")
    const { searchParams } = new URL(req.url)
    const record = searchParamsToRecord(searchParams)
    const result = await handleFundDataRequest(key, record)
    return fundDataResponse(result, record.format)
  } catch (err) {
    console.error("[fund-data]", err)
    return NextResponse.json(fundDataErr(3, "internal error"), { status: 500, headers: CORS })
  }
}

export async function POST(
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
    if (key !== "price/bulk") {
      return NextResponse.json(fundDataErr(1, "POST is only supported for /price/bulk"), {
        status: 405,
        headers: CORS,
      })
    }
    let body: Record<string, unknown> = {}
    try {
      const parsed = await req.json()
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json(fundDataErr(1, "JSON object body is required"), { status: 400, headers: CORS })
      }
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json(fundDataErr(1, "JSON object body is required"), { status: 400, headers: CORS })
    }
    const listed = body.reg_codes ?? body.reg_code
    const regCode = Array.isArray(listed)
      ? listed.map((code) => String(code)).join(",")
      : listed == null
        ? ""
        : String(listed)
    const record: Record<string, string | undefined> = {
      reg_code: regCode,
      start_date: body.start_date == null ? undefined : String(body.start_date),
      end_date: body.end_date == null ? undefined : String(body.end_date),
      cursor: body.cursor == null ? undefined : String(body.cursor),
      batch: body.batch == null ? undefined : String(body.batch),
      format: body.format == null ? undefined : String(body.format),
    }
    const result = await handleFundDataRequest(key, record)
    return fundDataResponse(result, record.format)
  } catch (err) {
    console.error("[fund-data]", err)
    return NextResponse.json(fundDataErr(3, "internal error"), { status: 500, headers: CORS })
  }
}
