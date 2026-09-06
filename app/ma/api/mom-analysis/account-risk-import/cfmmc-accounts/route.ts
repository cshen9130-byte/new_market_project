import { NextRequest, NextResponse } from "next/server"
import {
  addCfmmcAccount,
  deleteCfmmcAccount,
  publicCfmmcConfig,
  updateCfmmcAccount,
} from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      label?: string
      userId?: string
      password?: string
      enabled?: boolean
    }
    if (!body.userId?.trim()) {
      return NextResponse.json({ error: "请填写用户名" }, { status: 400 })
    }
    addCfmmcAccount({
      label: body.label,
      userId: body.userId,
      password: body.password ?? "",
      enabled: body.enabled,
    })
    return NextResponse.json({ ok: true, config: publicCfmmcConfig() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "添加失败" }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      id?: string
      label?: string
      userId?: string
      password?: string
      enabled?: boolean
    }
    if (!body.id) {
      return NextResponse.json({ error: "缺少账户 id" }, { status: 400 })
    }
    const account = updateCfmmcAccount(body.id, {
      label: body.label,
      userId: body.userId,
      password: body.password,
      enabled: body.enabled,
    })
    if (account.previousLabel && account.previousLabel !== account.label) {
      const { syncAccountRiskDirectNavDisplayNamesForAccount } = await import(
        "@/lib/server/account-risk-direct-nav-sync"
      )
      await syncAccountRiskDirectNavDisplayNamesForAccount({
        userId: account.userId,
        oldLabel: account.previousLabel,
        newLabel: account.label,
      }).catch((err) => {
        console.warn("[cfmmc-accounts] tracking name sync failed", err)
      })
    }
    return NextResponse.json({ ok: true, config: publicCfmmcConfig() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "更新失败" }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id") ?? ""
    if (!id) {
      return NextResponse.json({ error: "缺少 id" }, { status: 400 })
    }
    deleteCfmmcAccount(id)
    return NextResponse.json({ ok: true, config: publicCfmmcConfig() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "删除失败" }, { status: 400 })
  }
}
