import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { askKnowledgeBaseQuestion } from "@/lib/server/knowledge-chat"
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

    const answer = await askKnowledgeBaseQuestion({
      question: String(body?.question || ""),
      folderPath: body?.folderPath,
      filePath: body?.filePath ?? null,
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
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}