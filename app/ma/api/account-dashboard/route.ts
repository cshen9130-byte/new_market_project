import { NextResponse } from "next/server"

import { accountCanUseMom } from "@/lib/ma/account-dashboard"
import { readAccountDashboard, writeAccountDashboard } from "@/lib/server/account-dashboard-store"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const user = await getRequestUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 })
    const prefs = await readAccountDashboard(user.id, accountCanUseMom(user), user)
    return NextResponse.json({ ok: true, prefs })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务器错误"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getRequestUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const prefs = await writeAccountDashboard(user.id, body?.prefs, accountCanUseMom(user), user)
    return NextResponse.json({ ok: true, prefs })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务器错误"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getRequestUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const allowMom = accountCanUseMom(user)
    const current = await readAccountDashboard(user.id, allowMom, user)
    const patch = body?.prefs && typeof body.prefs === "object" ? body.prefs : body
    const prefs = await writeAccountDashboard(user.id, { ...current, ...patch }, allowMom, user)
    return NextResponse.json({ ok: true, prefs })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务器错误"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
