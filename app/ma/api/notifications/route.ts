import { NextResponse } from "next/server"
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/server/system-notifications"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }
  try {
    const data = await listNotifications(user.id)
    return NextResponse.json(data)
  } catch (error) {
    console.error("[notifications] list", error)
    return NextResponse.json({ error: "系统消息加载失败" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === "string" ? body.id.trim() : ""
  if (body?.all !== true && !id) {
    return NextResponse.json({ error: "缺少消息" }, { status: 400 })
  }
  try {
    const unread = body?.all === true
      ? await markAllNotificationsRead(user.id)
      : await markNotificationRead(user.id, id)
    return NextResponse.json({ ok: true, unread })
  } catch (error) {
    console.error("[notifications] read", error)
    return NextResponse.json({ error: "标记已读失败" }, { status: 500 })
  }
}
