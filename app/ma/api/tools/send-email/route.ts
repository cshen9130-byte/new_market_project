import { NextResponse } from "next/server"
import nodemailer from "nodemailer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { to, subject, content, smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure } = body

    if (!to || !subject || !content) {
      return NextResponse.json({ error: "收件人、主题和正文不能为空。" }, { status: 400 })
    }

    // Validate email addresses (basic check)
    const recipients: string[] = to
      .split(/[,;，；]/)
      .map((s: string) => s.trim())
      .filter(Boolean)

    if (recipients.length === 0) {
      return NextResponse.json({ error: "请输入至少一个有效收件人地址。" }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalid = recipients.filter((r) => !emailRegex.test(r))
    if (invalid.length > 0) {
      return NextResponse.json({ error: `以下地址格式有误：${invalid.join(", ")}` }, { status: 400 })
    }

    // Resolve SMTP config: request body > environment variables
    const host = smtpHost || process.env.SMTP_HOST
    const port = Number(smtpPort || process.env.SMTP_PORT || 465)
    const user = smtpUser || process.env.SMTP_USER
    const pass = smtpPass || process.env.SMTP_PASS
    const secure = smtpSecure !== undefined ? smtpSecure : (process.env.SMTP_SECURE !== "false")

    if (!host || !user || !pass) {
      return NextResponse.json(
        { error: "SMTP 配置不完整，请填写服务器、用户名和密码，或在服务器环境变量中配置。" },
        { status: 400 },
      )
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    })

    const info = await transporter.sendMail({
      from: user,
      to: recipients.join(", "),
      subject,
      html: content.replace(/\n/g, "<br>"),
    })

    return NextResponse.json({ success: true, messageId: info.messageId, accepted: info.accepted })
  } catch (error) {
    const message = error instanceof Error ? error.message : "邮件发送失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
