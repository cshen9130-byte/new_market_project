import { after } from "next/server"
import { NextResponse } from "next/server"
import { fetchEmailParseRecords } from "@/lib/server/email-parse-fetch"
import { refreshManagedProductsEmailNavLatest } from "@/lib/server/email-nav-latest-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 600

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const crawlEmailId =
      typeof (body as { crawlEmailId?: unknown }).crawlEmailId === "string"
        ? (body as { crawlEmailId: string }).crawlEmailId
        : undefined
    const daysRaw = (body as { days?: unknown }).days
    const days =
      typeof daysRaw === "number"
        ? daysRaw
        : typeof daysRaw === "string"
          ? parseInt(daysRaw, 10)
          : undefined

    const result = await fetchEmailParseRecords({
      crawlEmailId,
      days: Number.isFinite(days) && (days as number) > 0 ? (days as number) : undefined,
      skipNavLatestRefresh: true,
    })

    after(async () => {
      try {
        await refreshManagedProductsEmailNavLatest()
      } catch (e) {
        console.error("[email-parse-records/fetch] background nav refresh failed:", e)
      }
    })

    return NextResponse.json({
      ...result,
      navLatestRefreshQueued: true,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "抓取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
