import { NextResponse } from "next/server"
import { listImportedFiles } from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const { files, folder } = listImportedFiles()
  return NextResponse.json(
    { files, folder },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  )
}
