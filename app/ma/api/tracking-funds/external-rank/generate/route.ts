import { NextResponse } from "next/server"
import { buildExternalRankWeekFile } from "@/lib/server/external-rank-week"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const weekEnd = new URL(req.url).searchParams.get("week_end") || ""
    const { buffer, fileName } = await buildExternalRankWeekFile(weekEnd)
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[external-rank/generate]", err)
    const status = message.includes("没有") || message.includes("没能") ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
