import { NextResponse } from "next/server"
import { getEmailParseFetchJobStatus } from "@/lib/server/email-parse-fetch-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const status = getEmailParseFetchJobStatus()
  return NextResponse.json(status)
}
