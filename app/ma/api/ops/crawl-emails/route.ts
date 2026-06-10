import { NextResponse } from "next/server"
import { createCrawlEmail, listCrawlEmails } from "@/lib/server/crawl-emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json(listCrawlEmails())
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { emailType, account, pass, imapHost, imapPort, remark } = body as Record<string, unknown>

    if (!emailType || typeof emailType !== "string" || !emailType.trim()) {
      return NextResponse.json({ error: "请选择邮箱类型" }, { status: 400 })
    }
    if (!account || typeof account !== "string" || !account.trim()) {
      return NextResponse.json({ error: "账户不能为空" }, { status: 400 })
    }
    if (!pass || typeof pass !== "string" || !pass.trim()) {
      return NextResponse.json({ error: "密码/授权码不能为空" }, { status: 400 })
    }
    if (!imapHost || typeof imapHost !== "string" || !imapHost.trim()) {
      return NextResponse.json({ error: "IMAP 服务器不能为空" }, { status: 400 })
    }

    const row = await createCrawlEmail({
      emailType,
      account,
      pass,
      imapHost,
      imapPort: Number(imapPort || 993),
      remark: typeof remark === "string" ? remark : "",
    })

    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : "创建失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
