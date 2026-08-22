/**
 * account-risk/accounts
 * Imported 资金账号 plus 监控中心 linked logins.
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
