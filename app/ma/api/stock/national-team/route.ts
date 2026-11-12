import { NextResponse } from "next/server"
import {
  ensureNationalTeamTables,
  getNationalTeamPayload,
  spawnNationalTeamRefresh,
} from "@/lib/server/national-team-flows"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const summaryStart = searchParams.get("summary_start") || undefined
  const summaryEnd = searchParams.get("summary_end") || undefined
  const chartStart = searchParams.get("chart_start") || undefined
  const chartEnd = searchParams.get("chart_end") || undefined

  try {
    await ensureNationalTeamTables()
    const payload = await getNationalTeamPayload({
      summaryStart,
      summaryEnd,
      chartStart,
      chartEnd,
    })
    return NextResponse.json(payload)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { recent?: number; start?: string }
    const args: string[] = []
    if (body.start) {
      args.push("--start", body.start)
    } else {
      args.push("--recent", String(body.recent ?? 20))
    }
    spawnNationalTeamRefresh(args)
    return NextResponse.json({ ok: true, started: true, args })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
