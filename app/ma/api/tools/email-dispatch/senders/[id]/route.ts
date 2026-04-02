import { NextResponse } from "next/server"
import { readSenders, updateSender, deleteSender } from "@/lib/server/email-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sender = readSenders().find((s) => s.id === id)
    if (!sender) return NextResponse.json({ error: "账号不存在。" }, { status: 404 })
    // Return full record including pass (used for pre-filling edit form)
    return NextResponse.json(sender)
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取账号失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    // Only update provided fields; never overwrite pass with empty string
    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = String(body.name).trim()
    if (body.host !== undefined) patch.host = String(body.host).trim()
    if (body.port !== undefined) patch.port = Number(body.port)
    if (body.user !== undefined) patch.user = String(body.user).trim()
    if (body.pass !== undefined && String(body.pass).trim()) patch.pass = String(body.pass).trim()
    if (body.secure !== undefined) patch.secure = Boolean(body.secure)

    const updated = updateSender(id, patch)
    if (!updated) return NextResponse.json({ error: "账号不存在。" }, { status: 404 })

    const { pass: _pass, ...safeResult } = updated
    return NextResponse.json(safeResult)
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新账号失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ok = deleteSender(id)
    if (!ok) return NextResponse.json({ error: "账号不存在。" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除账号失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
