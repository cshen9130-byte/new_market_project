import { NextResponse } from "next/server"
import { isContractTenor } from "@/lib/all-weather/setup"
import { requireCshen } from "@/lib/server/require-cshen"
import { getNhciOverview, refreshNhciPaperBook, resetNhciPaperBook } from "@/lib/server/nhci-index-book"
import { writeNhciIndexSettings } from "@/lib/server/nhci-index-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await requireCshen(req)
  if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })
  try {
    const url = new URL(req.url)
    const refresh = url.searchParams.get("refresh") === "1"
    const data = await getNhciOverview(refresh)
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "加载失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const user = await requireCshen(req)
  if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.action === "setup") {
      if (!isContractTenor(body.contractTenor)) {
        return NextResponse.json({ error: "合约月份无效" }, { status: 400 })
      }
      writeNhciIndexSettings({ contractTenor: body.contractTenor })
      resetNhciPaperBook()
      const data = await refreshNhciPaperBook({ reset: true })
      return NextResponse.json({ ok: true, ...data })
    }
    if (body?.action === "reset") {
      resetNhciPaperBook()
      const data = await refreshNhciPaperBook({ reset: true })
      return NextResponse.json({ ok: true, ...data })
    }
    const data = await refreshNhciPaperBook()
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "刷新失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
