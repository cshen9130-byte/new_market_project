/**
 * account-risk/accounts
 * Imported books grouped by 拖入文件 / 邮箱获取 / 监控中心.
 */
import { NextResponse } from "next/server"
import { listCfmmcAccounts } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const accounts = await listCfmmcAccounts()
    return NextResponse.json({ ok: true, accounts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) return NextResponse.json({ ok: true, accounts: [] })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
