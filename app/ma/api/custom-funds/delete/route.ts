import { NextResponse } from "next/server"
import { deleteCustomFund } from "@/lib/server/custom-funds"

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

  const product_code = String((body as Record<string, unknown>).product_code || "").trim()
  if (!product_code) {
    return NextResponse.json({ error: "missing_product_code" }, { status: 400 })
  }

  const ownerUserId = currentUserId(req)
  const ok = deleteCustomFund(product_code, ownerUserId || undefined)
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
