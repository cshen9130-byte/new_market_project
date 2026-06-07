import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Create direct investment record — stub until storage is wired up. */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    void body
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
}
