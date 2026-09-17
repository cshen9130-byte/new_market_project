import { NextResponse } from "next/server"
import {
  applyElementExtractJobManually,
  applyUnregisteredElementExtractJob,
} from "@/lib/server/fund-contract-extract-job"
import { isUnregisteredPendingNote } from "@/lib/server/unregistered-fund-product"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUser(req: Request) {
  const rawName = String(req.headers.get("x-market-user-name") || "").trim()
  if (rawName) {
    try {
      return decodeURIComponent(rawName)
    } catch {
      return rawName
    }
  }
  return String(req.headers.get("x-market-user-id") || "").trim()
}

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
      register_number?: string | null
      create_unregistered?: boolean
      fields?: Record<string, string | null>
    }
    if (body.create_unregistered) {
      const row = await applyUnregisteredElementExtractJob({
        jobId,
        product_name: body.product_name,
        register_number: body.register_number,
        fields: body.fields,
        created_by: currentUser(req),
      })
      return NextResponse.json({
        ok: true,
        data: row,
        unregistered: isUnregisteredPendingNote(row.error_message),
      })
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
