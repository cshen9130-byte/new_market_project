import { NextResponse } from "next/server"
import { runCfmmcETL } from "@/lib/server/cfmmc-etl"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { mode?: string; bookId?: string; userId?: string; source?: string }
    const mode = body.mode === "full" ? "full" : "incremental"
    const bookId = typeof body.bookId === "string" ? body.bookId.trim() : undefined
    const userId = typeof body.userId === "string" ? body.userId.trim() : undefined
    const source = body.source === "upload" || body.source === "email" || body.source === "cfmmc"
      ? body.source
      : undefined
    const result = await runCfmmcETL(mode, { bookId, userId, source })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
