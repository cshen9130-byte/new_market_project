import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  canAccessOpsLedger,
  confirmServerOpsLedgerRecords,
} from "@/lib/server/ops-ledger-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

/** Mark one or many shared ledger rows as 已确认. Any logged-in user may confirm. */
export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessOpsLedger(user)) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const ids = Array.isArray(body?.ids)
      ? body.ids.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : typeof body?.id === "string"
        ? [body.id.trim()]
        : []
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "请选择要确认的台账" }, { status: 400 })
    }

    const records = await confirmServerOpsLedgerRecords(ids, {
      id: user.id,
      name: user.name || user.email || user.id,
    })
    return NextResponse.json({ ok: true, count: records.length, records })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[ops/ledger/confirm]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
