import { NextResponse } from "next/server"
import { listDownloadedFiles, readConfig } from "@/lib/server/settlement-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const { files, folder } = listDownloadedFiles()
  const cfg = readConfig()
  return NextResponse.json({
    files,
    folder,
    lastFetchDate: cfg.lastFetchDate,
    lastFetchAt: cfg.lastFetchAt,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
