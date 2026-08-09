import { NextResponse } from "next/server"
import { matchEmailConfirmRecords } from "@/lib/server/email-confirm-pg"
import { startEmailParseFetchJob } from "@/lib/server/email-parse-fetch-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Cover apply/confirm date with buffer; TA emails often arrive several days later. */
function refreshLookbackDays(applyDate?: string, confirmDate?: string): number {
  const today = Date.now()
  let days = 14
  for (const raw of [applyDate, confirmDate]) {
    if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) continue
    const t = new Date(`${raw.slice(0, 10)}T00:00:00Z`).getTime()
    if (!Number.isFinite(t)) continue
    const age = Math.ceil((today - t) / 86_400_000) + 10
    days = Math.max(days, age)
  }
  return Math.min(60, Math.max(14, days))
}

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
    let refreshDays: number | undefined
    if (body.refresh) {
      try {
        refreshDays = refreshLookbackDays(body.applyDate, body.confirmDate)
        const started = startEmailParseFetchJob({ light: true, days: refreshDays })
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

    return NextResponse.json({
      ok: true,
      data: candidates,
      refreshStarted,
      refreshDays,
    })
  } catch (err) {
    console.error("[ops/email-confirm-records/match POST]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "匹配确认单失败" },
      { status: 500 },
    )
  }
}
