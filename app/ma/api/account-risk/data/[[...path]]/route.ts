import { NextResponse } from "next/server"
import { handleAccountRiskDataRequest, isAccountRiskBinary } from "@/lib/server/account-risk-data-api"
import { momDataErr, type MomDataEnvelope } from "@/lib/server/mom-data-api"
import { requireMomDataApiUser } from "@/lib/server/mom-data-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, x-api-key, Authorization",
}

function json(result: MomDataEnvelope<unknown>) {
  const status = result.error_code === 0
    ? 200
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
    const record: Record<string, string | undefined> = {}
    new URL(req.url).searchParams.forEach((value, name) => {
      record[name] = value
    })
    const result = await handleAccountRiskDataRequest(key, record)
    if (isAccountRiskBinary(result)) {
      return new NextResponse(new Uint8Array(result.body), {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": result.contentType,
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "Cache-Control": "no-store",
        },
      })
    }
    return json(result)
  } catch (err) {
    console.error("[account-risk-data]", err)
    return json(momDataErr(3, "internal error"))
  }
}