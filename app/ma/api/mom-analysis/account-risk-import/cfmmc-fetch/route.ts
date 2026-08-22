import { NextRequest, NextResponse } from "next/server"
import { fetchCfmmcAccounts } from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const maxDuration = 1200

export async function POST(req: NextRequest) {
  try {
    let accountId: string | undefined
    try {
      const body = await req.json() as { accountId?: string }
      accountId = body.accountId
    } catch {
      // empty body = fetch all enabled
    }
    const result = await fetchCfmmcAccounts(accountId)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "获取失败" }, { status: 500 })
  }
}
