import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  getServerInstructionProcessConfig,
  saveServerInstructionProcessConfig,
} from "@/lib/server/instruction-process-config"
import { canAccessInstructionRecords } from "@/lib/server/instruction-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

/** Any logged-in user may read the shared process config. */
export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessInstructionRecords(user)) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const snapshot = await getServerInstructionProcessConfig()
    return NextResponse.json({
      ok: true,
      config: snapshot.config,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[instruction-process-config GET]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

/** Only admins may change 需要总经理审批 (and related process flags). */
export async function PUT(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    if (user.role !== "admin") {
      return NextResponse.json({ ok: false, error: "仅系统管理员可操作" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const snapshot = await saveServerInstructionProcessConfig(
      body?.config ?? body,
      user.name || user.email || user.id,
    )
    return NextResponse.json({
      ok: true,
      config: snapshot.config,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[instruction-process-config PUT]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
