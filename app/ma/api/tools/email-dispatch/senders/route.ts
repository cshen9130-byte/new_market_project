import { NextResponse } from "next/server"
import { readSenders, createSender } from "@/lib/server/email-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const senders = readSenders()
    // Strip passwords from the list response
    return NextResponse.json(
      senders.map(({ pass: _pass, ...rest }) => rest),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取发件账号失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, host, port, user, pass, secure } = body

    if (!name?.trim()) return NextResponse.json({ error: "账号名称不能为空。" }, { status: 400 })
    if (!host?.trim()) return NextResponse.json({ error: "SMTP 服务器不能为空。" }, { status: 400 })
    if (!user?.trim()) return NextResponse.json({ error: "用户名不能为空。" }, { status: 400 })
    if (!pass?.trim()) return NextResponse.json({ error: "密码不能为空。" }, { status: 400 })

    const sender = createSender({
      name: name.trim(),
      host: host.trim(),
      port: Number(port || 465),
      user: user.trim(),
      pass: pass.trim(),
      secure: secure !== false,
    })

    const { pass: _pass, ...safeResult } = sender
    return NextResponse.json(safeResult, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建发件账号失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
