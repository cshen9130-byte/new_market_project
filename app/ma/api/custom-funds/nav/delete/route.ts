import { NextResponse } from "next/server"
import { assertCustomFundAccess, deleteCustomFundNavRow } from "@/lib/server/custom-fund-nav"

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

  const { code, id } = body as { code?: string; id?: string }
  const productCode = (code || "").trim()
  const rowId = (id || "").trim()
  if (!productCode || !rowId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }

  const fund = assertCustomFundAccess(productCode, currentUserId(req) || undefined)
  if (!fund) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const ok = deleteCustomFundNavRow(productCode, rowId)
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
