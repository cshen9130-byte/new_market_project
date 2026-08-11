import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { parseLedgerBatchUploadBuffer } from "@/lib/server/ops-ledger-batch-upload"
import {
  canAccessOpsLedger,
  upsertServerOpsLedgerRecords,
  type OpsLedgerRow,
} from "@/lib/server/ops-ledger-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 3 * 1024 * 1024

function createLedgerId(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  const rand = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")
  return `L${y}${m}${d}${rand}`
}

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

/** Batch FOF ledger upload — parse Excel then persist to shared store. */
export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessOpsLedger(user)) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 })
    }

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing_file" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 400 })
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      return NextResponse.json({ error: "invalid_file_type" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseLedgerBatchUploadBuffer(buffer, file.name)
    if (parsed.length === 0) {
      return NextResponse.json({ error: "no_valid_rows" }, { status: 400 })
    }

    const toSave: OpsLedgerRow[] = parsed.map((row) => ({
      id: createLedgerId(),
      fof_fund_name: row.fof_fund_name,
      fof_register_number: row.fof_register_number || null,
      transaction_type: row.transaction_type,
      underlying_type: "FOF底层",
      underlying_fund_name: row.underlying_fund_name,
      underlying_beian_hao: row.underlying_beian_hao || null,
      apply_date: row.apply_date,
      confirm_date: row.confirm_date,
      confirmed_shares: row.confirmed_shares,
      confirmed_amount: row.confirmed_amount,
      confirmed_unit_nav: row.confirmed_unit_nav,
      transaction_fee: row.transaction_fee,
      performance_fee: row.performance_fee,
      share_balance: null,
      dividend_per_unit: row.dividend_per_unit,
      source: "批量上传",
      remark: row.remark,
      instruction_id: null,
      contract_attachment: null,
      confirm_attachment: null,
    }))

    const records = await upsertServerOpsLedgerRecords(toSave)
    return NextResponse.json({
      ok: true,
      count: records.length,
      rows: records,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "upload_failed"
    console.error("[ops/ledger/batch-upload]", message)
    return NextResponse.json({ error: "upload_failed" }, { status: 500 })
  }
}
