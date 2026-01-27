import { NextResponse } from "next/server"
import { verifyLogin } from "@/lib/server/users"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { identifier, password } = body || {}
    if (!identifier || !password) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 })
    }
    const user = await verifyLogin(identifier, password)
    if (!user) return NextResponse.json({ error: "账号或密码错误" }, { status: 401 })
    return NextResponse.json({ ok: true, user })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
