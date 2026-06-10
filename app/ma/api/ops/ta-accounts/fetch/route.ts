import { NextResponse } from "next/server"
import { fetchTaAccountsFromEmails } from "@/lib/server/ta-account-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const crawlEmailId =
      typeof (body as { crawlEmailId?: unknown }).crawlEmailId === "string"
        ? (body as { crawlEmailId: string }).crawlEmailId
        : undefined

    const result = await fetchTaAccountsFromEmails(crawlEmailId)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "抓取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
