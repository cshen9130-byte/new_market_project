import { NextResponse } from "next/server"
import { listEmailParseRecords, type ParseStepStatus } from "@/lib/server/email-parse-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseStatus(value: string | null, fallback: "all"): ParseStepStatus | "all" {
  if (value === "成功" || value === "失败") return value
  return fallback
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const result = listEmailParseRecords({
      tableNavStatus: parseStatus(url.searchParams.get("tableNavStatus"), "all"),
      postTableNavStatus: parseStatus(url.searchParams.get("postTableNavStatus"), "all"),
      valuationStatus: parseStatus(url.searchParams.get("valuationStatus"), "all"),
      ledgerStatus: parseStatus(url.searchParams.get("ledgerStatus"), "all"),
      sentFrom: url.searchParams.get("sentFrom") ?? undefined,
      sentTo: url.searchParams.get("sentTo") ?? undefined,
      subject: url.searchParams.get("subject") ?? undefined,
      page: Number(url.searchParams.get("page") ?? "1"),
      pageSize: Number(url.searchParams.get("pageSize") ?? "20"),
    })
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
