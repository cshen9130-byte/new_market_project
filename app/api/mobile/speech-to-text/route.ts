import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"

export const runtime = "nodejs"
export const maxDuration = 60

type Body = {
  audioBase64?: string
  mimeType?: string
}

function dashScopeChatCompletionsUrl(): string {
  const base = (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "")
  if (base.endsWith("/chat/completions")) return base
  return `${base}/chat/completions`
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""
  const root = payload as Record<string, unknown>
  const choices = root.choices
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const msg = (choices[0] as { message?: { content?: unknown } }).message
    if (typeof msg?.content === "string") return msg.content.trim()
  }
  const output = root.output
  if (output && typeof output === "object") {
    const out = output as Record<string, unknown>
    if (typeof out.text === "string") return out.text.trim()
    const nested = out.output
    if (nested && typeof nested === "object") {
      const sentence = (nested as { sentence?: { text?: unknown } }).sentence
      if (typeof sentence?.text === "string") return sentence.text.trim()
    }
  }
  return ""
}

export async function POST(req: Request) {
  try {
    const userId = req.headers.get("x-market-user-id")?.trim() || ""
    const user = userId ? await getUserById(userId) : null
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
    if (!apiKey) {
      return NextResponse.json({ error: "服务器未配置语音识别" }, { status: 503 })
    }

    const body = (await req.json()) as Body
    const raw = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : ""
    if (!raw || raw.length < 32) {
      return NextResponse.json({ error: "音频为空" }, { status: 400 })
    }
    // Cap ~8MB base64 (~6MB audio) for short hold-to-talk
    if (raw.length > 11_000_000) {
      return NextResponse.json({ error: "音频过长，请缩短说话时间" }, { status: 413 })
    }

    const mime = (typeof body.mimeType === "string" && body.mimeType.includes("/"))
      ? body.mimeType
      : "audio/wav"
    const dataUri = raw.startsWith("data:") ? raw : `data:${mime};base64,${raw}`

    const model =
      process.env.DASHSCOPE_ASR_MODEL?.trim() ||
      "qwen3-asr-flash"

    const res = await fetch(dashScopeChatCompletionsUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { data: dataUri },
              },
            ],
          },
        ],
        stream: false,
        asr_options: {
          language: "zh",
          enable_itn: false,
        },
      }),
    })

    const textBody = await res.text()
    let json: unknown = {}
    try {
      json = textBody ? JSON.parse(textBody) : {}
    } catch {
      json = { error: textBody.slice(0, 200) }
    }
    if (!res.ok) {
      const errObj = json && typeof json === "object" ? (json as { error?: { message?: string }; message?: string }) : {}
      const detail =
        errObj.error?.message ||
        errObj.message ||
        (typeof (json as { error?: string }).error === "string" ? (json as { error: string }).error : "") ||
        `ASR HTTP ${res.status}`
      return NextResponse.json({ error: detail }, { status: 502 })
    }

    const text = extractText(json)
    if (!text) {
      return NextResponse.json({ error: "未识别到有效语音", text: "" }, { status: 200 })
    }
    return NextResponse.json({ text })
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "语音识别失败"
    return NextResponse.json({ error: detail }, { status: 500 })
  }
}