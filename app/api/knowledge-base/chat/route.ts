import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { askKnowledgeBaseQuestion, streamKnowledgeBaseAnswer, type KbModelMode } from "@/lib/server/knowledge-chat"
import { appendMessage, countMessages, createConversation, updateConversationTitle } from "@/lib/server/chat-db"
import { appendTokenUsage } from "@/lib/server/token-usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const requestedConversationId: string | null = body?.conversationId ?? null
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null

    const scope = String(body?.filePath ?? body?.folderPath ?? "")
    const scopeType: "folder" | "file" = body?.filePath ? "file" : "folder"
    const titleCandidate = String(body?.title || body?.fileName || body?.folderName || scope || "新对话")
    let effectiveConversationId: string | null = requestedConversationId

    // Auto-create a conversation when user is authenticated but client hasn't created one yet.
    if (!effectiveConversationId && user) {
      const created = createConversation(user.id, titleCandidate.slice(0, 200), scope, scopeType)
      effectiveConversationId = created.id
    }

    const validModes: KbModelMode[] = ["auto", "plus", "turbo", "reasoning"]
    const modelMode: KbModelMode = validModes.includes(body?.modelMode) ? body.modelMode : "auto"

    // ── Streaming path (SSE) ───────────────────────────────────────────
    if (body?.stream === true) {
      const textEncoder = new TextEncoder()
      let fullAnswer = ""
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            const gen = streamKnowledgeBaseAnswer({
              question: String(body?.question || ""),
              folderPath: body?.folderPath,
              filePath: body?.filePath ?? null,
              useBm25: body?.useBm25 !== false,
              useGraphRag: body?.useGraphRag === true,
              modelMode,
            })
            for await (const event of gen) {
              if (event.type === "text") {
                fullAnswer += event.delta
                controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(event)}\n\n`))
              } else if (event.type === "done") {
                if (effectiveConversationId && user) {
                  const isFirst = countMessages(effectiveConversationId) === 0
                  appendMessage(effectiveConversationId, "user", String(body?.question || ""))
                  appendMessage(effectiveConversationId, "assistant", fullAnswer, event.sources)
                  if (isFirst) {
                    const q = String(body?.question || "").trim()
                    if (q) updateConversationTitle(effectiveConversationId, user.id, q.slice(0, 80))
                  }
                }
                // Record token usage for streaming responses when provider metadata is available.
                if (user && (event.tokenUsage?.totalTokens ?? 0) > 0) {
                  try {
                    appendTokenUsage({
                      userId: user.id,
                      userName: user.name,
                      inputTokens: event.tokenUsage!.inputTokens,
                      outputTokens: event.tokenUsage!.outputTokens,
                      totalTokens: event.tokenUsage!.totalTokens,
                      model: event.model ?? "unknown",
                      questionPreview: String(body?.question || "").trim().slice(0, 80),
                    })
                  } catch {}
                }
                controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({ ...event, conversationId: effectiveConversationId })}\n\n`))
                controller.enqueue(textEncoder.encode("data: [DONE]\n\n"))
              }
            }
          } catch (err: any) {
            const msg = String(err?.message || err)
            controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`))
          } finally {
            controller.close()
          }
        },
      })
      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      })
    }

    // ── Non-streaming path ───────────────────────────────────────────────
    const answer = await askKnowledgeBaseQuestion({
      question: String(body?.question || ""),
      folderPath: body?.folderPath,
      filePath: body?.filePath ?? null,
      useBm25: body?.useBm25 !== false,
      useGraphRag: body?.useGraphRag === true,
      modelMode,
    })

    if (effectiveConversationId && user) {
      const isFirst = countMessages(effectiveConversationId) === 0
      appendMessage(effectiveConversationId, "user", String(body?.question || ""))
      appendMessage(effectiveConversationId, "assistant", answer.answer, answer.sources)
      // Name conversation after the first question so history is meaningful
      if (isFirst) {
        const q = String(body?.question || "").trim()
        if (q) updateConversationTitle(effectiveConversationId, user.id, q.slice(0, 80))
      }
    }

    // Record token usage (fire-and-forget, non-blocking)
    if (user && (answer.tokenUsage?.totalTokens ?? 0) > 0) {
      try {
        appendTokenUsage({
          userId: user.id,
          userName: user.name,
          inputTokens: answer.tokenUsage!.inputTokens,
          outputTokens: answer.tokenUsage!.outputTokens,
          totalTokens: answer.tokenUsage!.totalTokens,
          model: answer.model ?? "unknown",
          questionPreview: String(body?.question || "").trim().slice(0, 80),
        })
      } catch {}
    }

    return NextResponse.json({ ok: true, conversationId: effectiveConversationId, ...answer })
  } catch (error: any) {
    const msg: string = error?.message || String(error)
    const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("quota")
    return NextResponse.json({ ok: false, error: msg }, { status: isRateLimit ? 429 : 500 })
  }
}