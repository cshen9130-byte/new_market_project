import { NextResponse } from "next/server"
import { matchEmailConfirmRecords } from "@/lib/server/email-confirm-pg"
import { startEmailParseFetchJob } from "@/lib/server/email-parse-fetch-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      fundName?: string
      fundCode?: string
      investorName?: string
      amount?: string
      applyDate?: string
      confirmDate?: string
      dateWindowDays?: number
      limit?: number
      /** When true, kick a light email fetch before matching. */
      refresh?: boolean
    }

    let refreshStarted = false
    if (body.refresh) {
      try {
        const started = startEmailParseFetchJob({ light: true, days: 7 })
        refreshStarted = started.ok === true
      } catch (e) {
        // Non-fatal: match against whatever is already stored.
        console.warn("[email-confirm-records/match] refresh skipped", e)
      }
    }

    const candidates = await matchEmailConfirmRecords({
      fundName: body.fundName,
      fundCode: body.fundCode,
      investorName: body.investorName,
      amount: body.amount,
      applyDate: body.applyDate,
      confirmDate: body.confirmDate,
      dateWindowDays: body.dateWindowDays,
      limit: body.limit,
    })

    return NextResponse.json({ ok: true, data: candidates, refreshStarted })
  } catch (err) {
    console.error("[ops/email-confirm-records/match POST]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "匹配确认单失败" },
      { status: 500 },
    )
  }
}
