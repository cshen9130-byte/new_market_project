import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Chart preview for custom funds — empty until NAV series is wired up. */
export async function GET() {
  return NextResponse.json({ fund: [], bench: [], name: "" })
}
