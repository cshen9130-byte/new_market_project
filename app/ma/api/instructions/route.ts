import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  canAccessInstructionRecords,
  deleteServerInstructionRecord,
  listServerInstructionRecords,
  upsertServerInstructionRecord,
} from "@/lib/server/instruction-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    if (!canAccessInstructionRecords(user)) {
      return NextResponse.json(
        { ok: false, error: "当前账号未分配指令角色，无法查看指令" },
        { status: 403 },
      )
    }

    const records = listServerInstructionRecords()
    return NextResponse.json({ ok: true, records })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    if (!canAccessInstructionRecords(user)) {
      return NextResponse.json(
        { ok: false, error: "当前账号未分配指令角色，无法发起/同步指令" },
        { status: 403 },
      )
    }

    const body = await req.json().catch(() => ({}))
    const record = upsertServerInstructionRecord(body?.record ?? body)
    return NextResponse.json({ ok: true, record })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    if (!canAccessInstructionRecords(user)) {
      return NextResponse.json(
        { ok: false, error: "当前账号未分配指令角色，无法更新指令" },
        { status: 403 },
      )
    }

    const body = await req.json().catch(() => ({}))
    const record = upsertServerInstructionRecord(body?.record ?? body)
    return NextResponse.json({ ok: true, record })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    if (!canAccessInstructionRecords(user)) {
      return NextResponse.json(
        { ok: false, error: "当前账号未分配指令角色，无法删除指令" },
        { status: 403 },
      )
    }

    const { searchParams } = new URL(req.url)
    const id = String(searchParams.get("id") || "").trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少指令 ID" }, { status: 400 })
    }

    const deleted = deleteServerInstructionRecord(id)
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "指令不存在" }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
