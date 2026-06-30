import { NextResponse } from "next/server"
import { listFofWeeklyBenchmarkOptions } from "@/lib/server/fof-weekly-benchmark"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ data: listFofWeeklyBenchmarkOptions() })
}
