import { NextResponse } from "next/server"
import { listCrawlEmails } from "@/lib/server/crawl-emails"
import {
  readYinheEmailConfig,
  resolveYinheMailbox,
  writeYinheEmailConfig,
  YINHE_DEFAULT_MAILBOX,
  type YinheEmailConfig,
} from "@/lib/server/yinhe-settlement-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const cfg = readYinheEmailConfig()
  const crawlAccounts = (await listCrawlEmails()).map((a) => ({
    account: a.account,
    emailType: a.emailType,
    imapHost: a.imapHost,
    imapPort: a.imapPort,
    crawlStatus: a.crawlStatus,
    remark: a.remark,
  }))

  let mailboxReady = false
  let mailboxSource: "crawl-email" | "local-config" | null = null
  let crawlStatus: string | null = null
  let resolveError: string | null = null
  try {
    const resolved = await resolveYinheMailbox(cfg)
    mailboxReady = true
    mailboxSource = resolved.source
    crawlStatus = resolved.crawlStatus ?? null
  } catch (e) {
    resolveError = e instanceof Error ? e.message : "邮箱凭据未就绪"
  }

  return NextResponse.json({
    email: cfg.email || YINHE_DEFAULT_MAILBOX,
    defaultEmail: YINHE_DEFAULT_MAILBOX,
    imapHost: cfg.imapHost,
    imapPort: cfg.imapPort,
    sender: cfg.sender,
    subjectIncludes: cfg.subjectIncludes,
    lookbackDays: cfg.lookbackDays,
    lastFetchAt: cfg.lastFetchAt,
    mailboxReady,
    mailboxSource,
    crawlStatus,
    resolveError,
    crawlAccounts,
  })
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<YinheEmailConfig>
    const prev = readYinheEmailConfig()
    const email =
      typeof body.email === "string" && body.email.trim()
        ? body.email.trim()
        : prev.email || YINHE_DEFAULT_MAILBOX

    // Sync IMAP host from crawl-email list when possible
    const crawlMatch = (await listCrawlEmails()).find(
      (a) => a.account.trim().toLowerCase() === email.toLowerCase(),
    )

    const next: YinheEmailConfig = {
      ...prev,
      email,
      imapHost:
        crawlMatch?.imapHost ||
        (typeof body.imapHost === "string" && body.imapHost.trim()
          ? body.imapHost.trim()
          : prev.imapHost || "imap.163.com"),
      imapPort:
        crawlMatch?.imapPort ||
        (typeof body.imapPort === "number" ? body.imapPort : prev.imapPort || 993),
      sender: typeof body.sender === "string" ? body.sender.trim() : prev.sender,
      subjectIncludes:
        typeof body.subjectIncludes === "string" ? body.subjectIncludes.trim() : prev.subjectIncludes,
      lookbackDays:
        typeof body.lookbackDays === "number" && body.lookbackDays > 0
          ? Math.min(730, Math.floor(body.lookbackDays))
          : prev.lookbackDays,
      // Do not store crawl-email passwords locally
      pass: "",
      lastFetchAt: prev.lastFetchAt,
    }
    writeYinheEmailConfig(next)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存配置失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
