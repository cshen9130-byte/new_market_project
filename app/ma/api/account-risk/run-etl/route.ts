import { NextResponse } from "next/server"
import { runCfmmcETL } from "@/lib/server/cfmmc-etl"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { mode?: string }
    const mode = body.mode === "full" ? "full" : "incremental"
    const result = await runCfmmcETL(mode)
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
