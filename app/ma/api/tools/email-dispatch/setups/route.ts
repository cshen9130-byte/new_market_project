import { NextResponse } from "next/server"
import { readSetups, createSetup } from "@/lib/server/email-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const setups = readSetups()
    return NextResponse.json(setups)
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取配置失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, senderId, traderCode, to, subject, content, scheduleTime, enabled } = body

    if (!name?.trim()) return NextResponse.json({ error: "配置名称不能为空。" }, { status: 400 })
    if (!traderCode?.trim()) return NextResponse.json({ error: "投顾代码不能为空。" }, { status: 400 })
    if (!Array.isArray(to) || to.length === 0)
      return NextResponse.json({ error: "至少需要一个收件人。" }, { status: 400 })
    if (!subject?.trim()) return NextResponse.json({ error: "邮件主题不能为空。" }, { status: 400 })
    if (!scheduleTime?.match(/^\d{2}:\d{2}$/))
      return NextResponse.json({ error: "发送时间格式须为 HH:MM。" }, { status: 400 })

    const setup = createSetup({
      name: name.trim(),
      senderId: senderId ?? null,
      traderCode: traderCode.trim(),
      to,
      subject: subject.trim(),
      content: content?.trim() ?? "",
      scheduleTime,
      enabled: enabled !== false,
    })

    return NextResponse.json(setup, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建配置失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
