import { NextResponse } from "next/server"
import { saveElementExtractJobElements } from "@/lib/server/fund-element-extract-jobs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const jobId = parseInt(id, 10)
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "无效的任务 ID" }, { status: 400 })
    }
    const body = (await req.json().catch(() => ({}))) as {
      extracted?: Record<string, unknown>
    }
    if (!body.extracted || typeof body.extracted !== "object" || Array.isArray(body.extracted)) {
      return NextResponse.json({ error: "请提供要保存的要素" }, { status: 400 })
    }
    const row = await saveElementExtractJobElements(jobId, body.extracted)
    return NextResponse.json({ ok: true, data: row })
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存失败"
    console.error("[ops/fund-elements/jobs PATCH]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
