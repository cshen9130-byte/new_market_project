import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { generateFofUnderlyingLedgerFromValuation } from "@/lib/server/ops-ledger-from-valuation"
import { canAccessOpsLedger } from "@/lib/server/ops-ledger-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

/** Build a first-pass 申赎台账 from FOF 估值表 share changes (+ 确认单 overlay). */
export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessOpsLedger(user)) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const result = await generateFofUnderlyingLedgerFromValuation()
    return NextResponse.json({ ok: true, ...result })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[ops/ledger/generate-from-valuation]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
