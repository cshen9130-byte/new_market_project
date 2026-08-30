import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  deleteHedgeWeightPreset,
  listHedgeWeightPresets,
  upsertHedgeWeightPreset,
  type HedgeWeightScope,
} from "@/lib/server/fof-hedge-weight-presets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

function parentBeianFromParams(params: { beian_hao?: string }): string {
  return decodeURIComponent(String(params.beian_hao ?? "")).trim()
}

function parseScope(raw: unknown): HedgeWeightScope | null {
  return raw === "team" || raw === "mine" ? raw : null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    const parentBeian = parentBeianFromParams(await params)
    if (!parentBeian) {
      return NextResponse.json({ ok: false, error: "缺少备案号" }, { status: 400 })
    }
    const data = await listHedgeWeightPresets(parentBeian, user.id)
    return NextResponse.json({ ok: true, ...data })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    const parentBeian = parentBeianFromParams(await params)
    if (!parentBeian) {
      return NextResponse.json({ ok: false, error: "缺少备案号" }, { status: 400 })
    }
    const body = await req.json().catch(() => ({}))
    const scope = parseScope(body?.scope)
    if (!scope) {
      return NextResponse.json({ ok: false, error: "请选择保存到团队或我的" }, { status: 400 })
    }
    const preset = await upsertHedgeWeightPreset({
      parentBeian,
      scope,
      userId: user.id,
      userName: user.name || user.email || "",
      name: String(body?.name ?? ""),
      lsNetAssumptionPct: Number(body?.lsNetAssumptionPct),
      overrides: body?.overrides && typeof body.overrides === "object"
        ? body.overrides as Record<string, number>
        : {},
    })
    const data = await listHedgeWeightPresets(parentBeian, user.id)
    return NextResponse.json({ ok: true, preset, ...data })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message.includes("最多保存") || message.includes("不能为空") ? 400 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    const parentBeian = parentBeianFromParams(await params)
    if (!parentBeian) {
      return NextResponse.json({ ok: false, error: "缺少备案号" }, { status: 400 })
    }
    const { searchParams } = new URL(req.url)
    const id = String(searchParams.get("id") || "").trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少方案 ID" }, { status: 400 })
    }
    const deleted = await deleteHedgeWeightPreset({ id, userId: user.id })
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "方案不存在或无权删除" }, { status: 404 })
    }
    const data = await listHedgeWeightPresets(parentBeian, user.id)
    return NextResponse.json({ ok: true, ...data })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
