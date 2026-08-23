import { NextResponse } from "next/server"
import { requireCshen } from "@/lib/server/require-cshen"
import {
  publicEmailConfig,
  readEmailConfig,
  sendAllWeatherEmail,
  testSenderConnection,
  writeEmailConfig,
  type ExtraEmailAttachment,
} from "@/lib/server/all-weather-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(req: Request) {
  const user = await requireCshen(req)
  if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })
  return NextResponse.json({ ok: true, config: publicEmailConfig(readEmailConfig()) })
}

export async function PUT(req: Request) {
  const user = await requireCshen(req)
  if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })
  try {
    const body = await req.json()
    const current = readEmailConfig()
    const receivers = Array.isArray(body.receivers)
      ? body.receivers.map((s: unknown) => String(s).trim()).filter(Boolean)
      : String(body.receiversText || "")
          .split(/[,;，；\s]+/)
          .map((s: string) => s.trim())
          .filter(Boolean)

    const invalid = receivers.filter((r: string) => !EMAIL_RE.test(r))
    if (invalid.length) {
      return NextResponse.json({ error: `收件地址格式有误：${invalid.join(", ")}` }, { status: 400 })
    }

    let sender = current.sender
    if (body.sender) {
      const nextPass = String(body.sender.pass || "").trim()
      sender = {
        name: String(body.sender.name || "").trim() || "全天候发件箱",
        host: String(body.sender.host || "").trim(),
        port: Number(body.sender.port || 465),
        user: String(body.sender.user || "").trim(),
        pass: nextPass || current.sender?.pass || "",
        secure: body.sender.secure !== false,
      }
      if (!sender.host || !sender.user) {
        return NextResponse.json({ error: "请填写发件 SMTP 服务器和登录邮箱。" }, { status: 400 })
      }
    }

    const scheduleTime = String(body.scheduleTime || current.scheduleTime || "09:00")
    if (!/^\d{2}:\d{2}$/.test(scheduleTime)) {
      return NextResponse.json({ error: "发送时间格式应为 HH:MM。" }, { status: 400 })
    }

    const saved = writeEmailConfig({
      sender,
      receivers,
      scheduleTime,
      enabled: Boolean(body.enabled),
      lastSentDate: current.lastSentDate,
      lastSentAt: current.lastSentAt,
    })
    return NextResponse.json({ ok: true, config: publicEmailConfig(saved) })
  } catch (e) {
    const message = e instanceof Error ? e.message : "保存失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

const MAX_EXTRA_FILES = 8
const MAX_EXTRA_BYTES = 20 * 1024 * 1024

function safeFilename(name: string): string {
  const base = name.replace(/[/\\]/g, "").replace(/^\.+/, "").trim()
  return base.slice(0, 180) || "attachment"
}

export async function POST(req: Request) {
  const user = await requireCshen(req)
  if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })
  try {
    const contentType = req.headers.get("content-type") || ""
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      if (String(form.get("action") || "send") === "test") {
        await testSenderConnection()
        return NextResponse.json({ ok: true })
      }
      const extras: ExtraEmailAttachment[] = []
      let total = 0
      for (const item of form.getAll("files")) {
        if (typeof item === "string" || typeof item.arrayBuffer !== "function" || item.size <= 0) continue
        if (extras.length >= MAX_EXTRA_FILES) {
          return NextResponse.json({ error: `一次性附件最多 ${MAX_EXTRA_FILES} 个。` }, { status: 400 })
        }
        total += item.size
        if (total > MAX_EXTRA_BYTES) {
          return NextResponse.json({ error: "一次性附件合计不能超过 20MB。" }, { status: 400 })
        }
        extras.push({
          filename: safeFilename(item.name),
          content: Buffer.from(await item.arrayBuffer()),
          contentType: item.type || "application/octet-stream",
        })
      }
      const result = await sendAllWeatherEmail({ extraAttachments: extras })
      return NextResponse.json({ ok: true, ...result, config: publicEmailConfig(readEmailConfig()) })
    }

    const body = await req.json().catch(() => ({}))
    if (body?.action === "test") {
      await testSenderConnection()
      return NextResponse.json({ ok: true })
    }
    const result = await sendAllWeatherEmail()
    return NextResponse.json({ ok: true, ...result, config: publicEmailConfig(readEmailConfig()) })
  } catch (e) {
    const message = e instanceof Error ? e.message : "发送失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
