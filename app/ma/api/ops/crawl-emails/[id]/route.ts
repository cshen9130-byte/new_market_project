import { NextResponse } from "next/server"
import { deleteCrawlEmail, updateCrawlEmail } from "@/lib/server/crawl-emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const patch: Record<string, unknown> = {}
    for (const key of ["emailType", "account", "pass", "imapHost", "remark"] as const) {
      if (key in body) patch[key] = body[key]
    }
    if ("imapPort" in body) patch.imapPort = Number(body.imapPort || 993)
    if ("imapFolders" in body && Array.isArray(body.imapFolders)) {
      patch.imapFolders = (body.imapFolders as unknown[])
        .map((f) => String(f).trim())
        .filter(Boolean)
    }

    const row = await updateCrawlEmail(id, patch as Parameters<typeof updateCrawlEmail>[1])
    if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    return NextResponse.json(row)
  } catch (e) {
    const message = e instanceof Error ? e.message : "更新失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ok = deleteCrawlEmail(id)
    if (!ok) return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "删除失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
