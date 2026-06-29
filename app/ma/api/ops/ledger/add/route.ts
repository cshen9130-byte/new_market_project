import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Single FOF ledger entry — storage not yet wired up. */
export async function POST(req: Request) {
  try {
    await req.json()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
}
