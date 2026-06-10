import { NextResponse } from "next/server"
import { backfillSenderEmails } from "@/lib/server/email-parse-fetch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const items = Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: { crawlEmailAccount?: string; uid?: string }[] }).items
          .filter((item) => item.crawlEmailAccount && item.uid)
          .map((item) => ({
            crawlEmailAccount: String(item.crawlEmailAccount),
            uid: String(item.uid),
          }))
      : undefined
    const result = await backfillSenderEmails(items?.length ? { items } : undefined)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "补全失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
