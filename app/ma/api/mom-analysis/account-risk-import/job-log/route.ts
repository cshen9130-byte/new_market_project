import { NextResponse } from "next/server"
import { clearJobLog, getJobLogSnapshot } from "@/lib/server/account-risk-job-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    { ok: true, lines: getJobLogSnapshot() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  )
}

export async function DELETE() {
  clearJobLog()
  return NextResponse.json({ ok: true })
}
