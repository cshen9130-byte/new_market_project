import { NextResponse } from "next/server"
import { lookupBeianCodesWithNav } from "@/lib/server/fund-nav-presence"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const codes = (searchParams.get("codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)

  if (codes.length === 0) {
    return NextResponse.json({ has_nav: {} })
  }

  const limited = codes.slice(0, 200)
  const present = await lookupBeianCodesWithNav(limited)
  if (!present) {
    return NextResponse.json({ has_nav: null })
  }

  const has_nav: Record<string, boolean> = {}
  for (const code of limited) {
    has_nav[code.trim().toUpperCase()] = present.has(code.trim().toUpperCase())
  }
  return NextResponse.json({ has_nav })
}
