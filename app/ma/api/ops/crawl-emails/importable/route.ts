import { NextResponse } from "next/server"
import { listImportableConfiguredEmails } from "@/lib/server/crawl-emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json(listImportableConfiguredEmails())
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
