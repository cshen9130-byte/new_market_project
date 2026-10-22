import { NextResponse } from "next/server"
import { clearUserAvatar, getUserById, setUserAvatar } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

async function currentUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return null
  return getUserById(userId)
}

export async function POST(req: Request) {
  try {
    const user = await currentUser(req)
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 })

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择图片" }, { status: 400 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "图片过大（最大 2MB）" }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const updated = await setUserAvatar(user.id, bytes)
    return NextResponse.json({ ok: true, user: updated })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "上传失败"
    const status = message === "用户不存在" ? 404 : message.startsWith("图片") || message.startsWith("请上传") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await currentUser(req)
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 })
    const updated = await clearUserAvatar(user.id)
    return NextResponse.json({ ok: true, user: updated })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "移除失败"
    const status = message === "用户不存在" ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
