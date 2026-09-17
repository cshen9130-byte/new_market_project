import { NextResponse } from "next/server"
import { readWeeklyAttributionJobFile } from "@/lib/server/jy-weekly-attribution"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || ""
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 })
  try {
    const { buffer, fileName } = await readWeeklyAttributionJobFile(id)
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
