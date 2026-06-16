import { NextResponse } from "next/server"
import {
  getEmailParseFetchJobStatus,
  startEmailParseFetchJob,
} from "@/lib/server/email-parse-fetch-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    const normalizedDays =
      Number.isFinite(days) && (days as number) > 0 ? (days as number) : undefined

    const started = startEmailParseFetchJob({
      crawlEmailId,
      days: normalizedDays,
    })

    if (!started.ok) {
      return NextResponse.json(
        { error: "邮件扫描任务正在进行中，请稍候", status: getEmailParseFetchJobStatus() },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { started: true, status: "queued", days: normalizedDays },
      { status: 202 },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "抓取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
