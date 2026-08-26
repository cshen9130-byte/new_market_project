import { NextResponse } from "next/server"
import { recordInteractiveUserTraffic } from "@/lib/server/user-activity-priority"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function pagePathFromRequest(req: Request): string {
  const raw = new URL(req.url).searchParams.get("path") || ""
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return "/"
  return raw.split("?")[0].slice(0, 200) || "/"
}

export async function GET(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (userId) {
    recordInteractiveUserTraffic(pagePathFromRequest(req), "GET", userId)
  }
  return NextResponse.json({ ok: true })
}
