import { NextResponse } from "next/server"
import {
  deleteFundContractMaterial,
  updateFundContractMaterialMeta,
} from "@/lib/server/fund-contract-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const recordId = parseInt(id, 10)
    if (!Number.isFinite(recordId)) {
      return NextResponse.json({ error: "无效的记录 ID" }, { status: 400 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      chart_date?: string | null
      title?: string | null
    }

    const patch: { chart_date?: string | null; title?: string | null } = {}
    if ("chart_date" in body) patch.chart_date = body.chart_date ?? null
    if ("title" in body) patch.title = body.title ?? null

    if (!("chart_date" in patch) && !("title" in patch)) {
      return NextResponse.json({ error: "缺少可更新字段" }, { status: 400 })
    }

    const row = await updateFundContractMaterialMeta(recordId, patch)
    if (!row) {
      return NextResponse.json({ error: "资料不存在" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, data: row })
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新资料失败"
    console.error("[ops/fund-contracts PATCH]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const recordId = parseInt(id, 10)
    if (!Number.isFinite(recordId)) {
      return NextResponse.json({ error: "无效的记录 ID" }, { status: 400 })
    }

    const deleted = await deleteFundContractMaterial(recordId)
    if (!deleted) {
      return NextResponse.json({ error: "合同文件不存在" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[ops/fund-contracts DELETE]", err)
    return NextResponse.json({ error: "删除合同失败" }, { status: 500 })
  }
}
