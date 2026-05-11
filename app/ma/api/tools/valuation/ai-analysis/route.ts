import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEEPSEEK_BASE = "https://api.deepseek.com/v1"
const DEEPSEEK_MODEL = "deepseek-chat"

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json()

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "缺少 prompt 参数。" }, { status: 400 })
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 500 })
    }

    const dsResponse = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content:
              "你是一名专业的私募基金分析师，擅长从估值表数据中洞察基金策略逻辑与风险特征。用简洁、专业的中文回答。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
        stream: false,
      }),
    })

    if (!dsResponse.ok) {
      const errBody = await dsResponse.text()
      return NextResponse.json(
        { message: `上游 AI 服务错误 (${dsResponse.status}): ${errBody}` },
        { status: 502 },
      )
    }

    const dsData = await dsResponse.json()
    const content = dsData.choices?.[0]?.message?.content?.trim() ?? ""

    if (!content) {
      return NextResponse.json({ message: "AI 返回内容为空" }, { status: 502 })
    }

    return NextResponse.json({ ai_analysis: content })
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 分析请求失败。"
    return NextResponse.json({ message }, { status: 500 })
  }
}
