import { NextResponse } from "next/server"
import { parseLedgerBatchUploadBuffer } from "@/lib/server/ops-ledger-batch-upload"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 3 * 1024 * 1024

/** Batch FOF ledger upload — storage not yet wired up. */
export async function POST(req: Request) {
  try {
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
    const rows = parseLedgerBatchUploadBuffer(buffer, file.name)
    if (rows.length === 0) {
      return NextResponse.json({ error: "no_valid_rows" }, { status: 400 })
    }

    return NextResponse.json({ ok: true, count: rows.length, rows })
  } catch {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 })
  }
}
