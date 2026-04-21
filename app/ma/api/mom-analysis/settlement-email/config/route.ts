import { NextRequest, NextResponse } from "next/server"
import { readConfig, writeConfig, SettlementEmailConfig } from "@/lib/server/settlement-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const cfg = readConfig()
  // Mask password for the response
  return NextResponse.json({ ...cfg, pass: cfg.pass ? "••••••••" : "" })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<SettlementEmailConfig>
    const current = readConfig()

    const updated: SettlementEmailConfig = {
      ...current,
      email: typeof body.email === "string" ? body.email.trim() : current.email,
      imapHost: typeof body.imapHost === "string" ? body.imapHost.trim() : current.imapHost,
      imapPort: typeof body.imapPort === "number" ? body.imapPort : current.imapPort,
      enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
      scheduleTime: typeof body.scheduleTime === "string" ? body.scheduleTime.trim() : current.scheduleTime,
      sender: typeof body.sender === "string" ? body.sender.trim() : current.sender,
    }

    // Only overwrite password if a real value is sent (not the masked placeholder)
    if (typeof body.pass === "string" && body.pass && !body.pass.startsWith("•")) {
      updated.pass = body.pass
    }

    writeConfig(updated)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败" }, { status: 400 })
  }
}
