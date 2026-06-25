import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Team member options for custom fund filters — empty until user directory is wired up. */
export async function GET() {
  return NextResponse.json({ data: [] })
}
