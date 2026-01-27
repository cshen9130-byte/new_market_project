import { NextResponse } from "next/server"
import { addUser, listUsers } from "@/lib/server/users"

export async function GET() {
  try {
    const users = await listUsers()
    return NextResponse.json({ ok: true, users })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { email, name, password, role } = body || {}
    if (!email || !name || !password) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 })
    }
    const user = await addUser({ email, name, password, role })
    return NextResponse.json({ ok: true, user })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
