import { NextResponse } from "next/server"
import { applyElementExtractJobManually } from "@/lib/server/fund-contract-extract-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
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
      beian_hao?: string
      product_name?: string | null
      fields?: Record<string, string | null>
    }
    const beian_hao = String(body.beian_hao ?? "").trim()
    if (!beian_hao) {
      return NextResponse.json({ error: "请选择目标产品" }, { status: 400 })
    }
    const row = await applyElementExtractJobManually({
      jobId,
      beian_hao,
      product_name: body.product_name,
      fields: body.fields,
    })
    return NextResponse.json({ ok: true, data: row })
  } catch (err) {
    const message = err instanceof Error ? err.message : "写入失败"
    console.error("[ops/fund-elements/jobs apply]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
