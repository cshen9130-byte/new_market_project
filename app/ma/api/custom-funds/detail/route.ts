import { NextResponse } from "next/server"
import { getCustomFundDetail } from "@/lib/server/custom-funds"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUserId(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get("code") || "").trim()
  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 })
  }

  const userId = currentUserId(req)
  const fund = getCustomFundDetail(code, userId || undefined)
  if (!fund) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json(fund)
}
