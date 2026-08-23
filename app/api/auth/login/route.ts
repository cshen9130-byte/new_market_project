import { NextResponse } from "next/server"
import { clientIpFromRequest } from "@/lib/server/deploy-readiness"
import { recordLoginAttempt } from "@/lib/server/login-history"
import { verifyLogin } from "@/lib/server/users"

async function safeRecord(input: Parameters<typeof recordLoginAttempt>[0]) {
  try {
    await recordLoginAttempt(input)
  } catch {
    // Login must still succeed if audit write fails.
  }
}

export async function POST(req: Request) {
  const ip = clientIpFromRequest(req)
  const userAgent = req.headers.get("user-agent")
  try {
    const body = await req.json()
    const { identifier, password } = body || {}
    if (!identifier || !password) {
      await safeRecord({
        success: false,
        identifier: String(identifier || ""),
        ip,
        userAgent,
        failReason: "incomplete",
      })
      return NextResponse.json({ error: "参数不完整" }, { status: 400 })
    }
    const user = await verifyLogin(identifier, password)
    if (!user) {
      await safeRecord({
        success: false,
        identifier: String(identifier),
        ip,
        userAgent,
        failReason: "invalid_credentials",
      })
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 })
    }
    await safeRecord({
      success: true,
      identifier: String(identifier),
      ip,
      userAgent,
      user: { id: user.id, name: user.name, email: user.email },
    })
    return NextResponse.json({ ok: true, user })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
