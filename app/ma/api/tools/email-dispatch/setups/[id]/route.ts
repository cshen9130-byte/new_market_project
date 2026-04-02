import { NextResponse } from "next/server"
import { updateSetup, deleteSetup } from "@/lib/server/email-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const updated = updateSetup(id, body)
    if (!updated) return NextResponse.json({ error: "配置不存在。" }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新配置失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ok = deleteSetup(id)
    if (!ok) return NextResponse.json({ error: "配置不存在。" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除配置失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
