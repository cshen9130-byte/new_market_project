import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  canAccessOpsLedger,
  upsertServerOpsLedgerRecord,
  upsertServerOpsLedgerRecords,
} from "@/lib/server/ops-ledger-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

/** Upsert one or many FOF ledger rows into the shared store. */
export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessOpsLedger(user)) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body?.records)) {
      const records = await upsertServerOpsLedgerRecords(body.records)
      return NextResponse.json({ ok: true, records })
    }
    const record = await upsertServerOpsLedgerRecord(body?.record ?? body)
    return NextResponse.json({ ok: true, record })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[ops/ledger/add]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  return POST(req)
}
