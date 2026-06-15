import { NextResponse } from "next/server"
import { ImapFlow } from "imapflow"
import { getCrawlEmailById } from "@/lib/server/crawl-emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const account = getCrawlEmailById(id)
    if (!account) return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    if (!account.pass?.trim()) return NextResponse.json({ error: "未配置授权码" }, { status: 400 })

    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.account, pass: account.pass },
      logger: false,
    })

    await client.connect()
    let folders: string[] = []
    try {
      const list = await client.list()
      folders = list.map((m) => m.path).sort()
    } finally {
      try { await client.logout() } catch { /* ignore */ }
    }

    return NextResponse.json({ folders })
  } catch (e) {
    const message = e instanceof Error ? e.message : "获取文件夹失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
