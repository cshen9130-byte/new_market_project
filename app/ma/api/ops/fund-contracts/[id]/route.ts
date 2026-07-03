import { NextResponse } from "next/server"
import { deleteFundContractMaterial } from "@/lib/server/fund-contract-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
