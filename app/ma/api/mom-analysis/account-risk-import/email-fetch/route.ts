import { NextResponse } from "next/server"
import { fetchAccountRiskEmails } from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const result = await fetchAccountRiskEmails()
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "获取失败" }, { status: 500 })
  }
}
