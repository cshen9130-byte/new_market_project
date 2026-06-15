import { NextResponse } from "next/server"
import { fetchEmailParseRecords } from "@/lib/server/email-parse-fetch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300  // allow up to 5 minutes for large mailbox scans

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const crawlEmailId =
      typeof (body as { crawlEmailId?: unknown }).crawlEmailId === "string"
        ? (body as { crawlEmailId: string }).crawlEmailId
        : undefined
    const days =
      typeof (body as { days?: unknown }).days === "number"
        ? (body as { days: number }).days
        : undefined

    const result = await fetchEmailParseRecords({ crawlEmailId, days })
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "抓取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
