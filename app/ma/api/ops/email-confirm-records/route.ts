import { NextResponse } from "next/server"
import { listEmailConfirmRecords } from "@/lib/server/email-confirm-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const fundName = url.searchParams.get("fund_name") || undefined
    const fundCode = url.searchParams.get("fund_code") || undefined
    const page = parseInt(url.searchParams.get("page") || "1", 10)
    const pageSize = parseInt(url.searchParams.get("pageSize") || "50", 10)
    const result = await listEmailConfirmRecords({ fundName, fundCode, page, pageSize })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[ops/email-confirm-records GET]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "加载确认单失败" },
      { status: 500 },
    )
  }
}
