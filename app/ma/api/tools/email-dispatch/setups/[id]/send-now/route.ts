import { NextResponse } from "next/server"
import { readSetups, sendDispatch, updateSetup } from "@/lib/server/email-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const setups = readSetups()
    const setup = setups.find((s) => s.id === id)
    if (!setup) return NextResponse.json({ error: "配置不存在。" }, { status: 404 })

    const result = await sendDispatch(setup)

    const now = new Date()
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
    updateSetup(id, { lastSentDate: today, lastSentAt: now.toISOString() })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "邮件发送失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
