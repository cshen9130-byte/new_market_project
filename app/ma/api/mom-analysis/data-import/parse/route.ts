// This route is no longer used — superseded by the folder explorer routes.
import { NextResponse } from "next/server"
export const runtime = "nodejs"
export async function POST() {
  return NextResponse.json({ error: "Use /list, /upload, or /rename instead." }, { status: 410 })
}
