/**
 * account-risk/account-overview
 * Latest snapshot per 资金账号 for 单账户总览.
 */
import { NextResponse } from "next/server"
import { loadAccountOverviewRows } from "@/lib/server/account-risk-account-overview"
import { withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET() {
  try {
    const rows = await loadAccountOverviewRows()
    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, rows: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
