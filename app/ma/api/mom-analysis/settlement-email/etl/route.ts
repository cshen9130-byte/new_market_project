import { NextResponse } from "next/server"
import { runAccountSummaryETL } from "@/lib/server/settlement-account-etl"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let mode: "full" | "incremental" = "incremental"
  try {
    const body = await request.json() as { mode?: string }
    if (body?.mode === "full") mode = "full"
  } catch { /* default to incremental */ }

  try {
    const result = await runAccountSummaryETL(mode)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
