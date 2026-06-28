import { NextResponse } from "next/server"
import { assertCustomFundAccess, uploadCustomFundNavRows } from "@/lib/server/custom-fund-nav"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUserId(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const { code, rows } = body as {
    code?: string
    rows?: Array<{ nav_date?: string; unit_nav?: string; cumulative_nav?: string; nav_source?: string }>
  }

  const productCode = (code || "").trim()
  if (!productCode) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 })
  }

  const fund = assertCustomFundAccess(productCode, currentUserId(req) || undefined)
  if (!fund) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const result = uploadCustomFundNavRows(
    productCode,
    Array.isArray(rows) ? rows : [],
  )

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true, count: result.count })
}
