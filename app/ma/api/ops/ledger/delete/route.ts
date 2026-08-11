import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  canAccessOpsLedger,
  deleteServerOpsLedgerByInstructionId,
  deleteServerOpsLedgerRecord,
} from "@/lib/server/ops-ledger-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

/** Delete a ledger row by id, or all rows for an instruction_id. */
export async function DELETE(req: Request) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessOpsLedger(user)) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = String(searchParams.get("id") || "").trim()
    const instructionId = String(searchParams.get("instruction_id") || "").trim()

    if (instructionId) {
      const removed = await deleteServerOpsLedgerByInstructionId(instructionId)
      return NextResponse.json({ ok: true, removed })
    }
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少台账 ID" }, { status: 400 })
    }
    const deleted = await deleteServerOpsLedgerRecord(id)
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "台账不存在" }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[ops/ledger/delete]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
