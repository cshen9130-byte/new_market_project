import { NextResponse } from "next/server"
import { listMomUnderlyingProducts } from "@/lib/server/mom-underlying-list"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await listMomUnderlyingProducts()
    return NextResponse.json(
      { ok: true, data, total: data.length },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
