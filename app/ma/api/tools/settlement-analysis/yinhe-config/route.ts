import { NextResponse } from "next/server"
import {
  readYinheEmailConfig,
  writeYinheEmailConfig,
  type YinheEmailConfig,
} from "@/lib/server/yinhe-settlement-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const cfg = readYinheEmailConfig()
  return NextResponse.json({
    email: cfg.email,
    imapHost: cfg.imapHost,
    imapPort: cfg.imapPort,
    sender: cfg.sender,
    subjectIncludes: cfg.subjectIncludes,
    lookbackDays: cfg.lookbackDays,
    lastFetchAt: cfg.lastFetchAt,
    hasPass: Boolean(cfg.pass),
  })
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<YinheEmailConfig> & { pass?: string }
    const prev = readYinheEmailConfig()
    const next: YinheEmailConfig = {
      ...prev,
      email: typeof body.email === "string" ? body.email.trim() : prev.email,
      imapHost: typeof body.imapHost === "string" ? body.imapHost.trim() : prev.imapHost,
      imapPort: typeof body.imapPort === "number" ? body.imapPort : prev.imapPort,
      sender: typeof body.sender === "string" ? body.sender.trim() : prev.sender,
      subjectIncludes:
        typeof body.subjectIncludes === "string" ? body.subjectIncludes.trim() : prev.subjectIncludes,
      lookbackDays:
        typeof body.lookbackDays === "number" && body.lookbackDays > 0
          ? Math.min(730, Math.floor(body.lookbackDays))
          : prev.lookbackDays,
      // Keep existing password unless a non-empty new one is provided
      pass: typeof body.pass === "string" && body.pass.trim() ? body.pass.trim() : prev.pass,
      lastFetchAt: prev.lastFetchAt,
    }
    writeYinheEmailConfig(next)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存配置失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
