import { authService } from "@/lib/auth"

export type KnowledgeChatScope = {
  folderPath?: string | null
  filePath?: string | null
  filePaths?: string[] | null
  inlineDocuments?: Array<{ name: string; text: string }> | null
  title?: string
  fileName?: string
  folderName?: string
}

export type KnowledgeChatStreamEvent =
  | { type: "text"; delta: string; modelId?: string }
  | { type: "done"; sources?: string[]; conversationId?: string; model?: string }
  | { type: "error"; message: string }
  | { type: "phase"; phase: string }

export function getKnowledgeBaseAuthHeaders(): Record<string, string> | undefined {
  const user = authService.getCurrentUser()
  if (!user?.id) return undefined
  return { "x-market-user-id": user.id }
}

export async function ensureKnowledgeConversation(scope: KnowledgeChatScope): Promise<string | null> {
  const headers = getKnowledgeBaseAuthHeaders()
  if (!headers) return null

  const filePath = scope.filePath?.trim() || null
  const folderPath = scope.folderPath?.trim() || ""
  const filePaths = scope.filePaths?.filter(Boolean) ?? []
  const kbScope = filePaths.length > 0
    ? `sidebar:${filePaths.join(",")}`
    : filePath ?? folderPath
  const scopeType: "folder" | "file" = filePath && filePaths.length === 0 ? "file" : "folder"

  try {
    const res = await fetch("/api/knowledge-base/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ title: "新对话", scope: kbScope, scopeType }),
    })
    const data = await res.json()
    if (!res.ok || !data?.ok) return null
    return String(data.conversation?.id || "") || null
  } catch {
    return null
  }
}

export async function streamKnowledgeBaseChat(input: {
  question: string
  scope: KnowledgeChatScope
  conversationId?: string | null
  /** Prior turns only (exclude the current user question). */
  history?: Array<{ role: "user" | "assistant"; content: string }>
  signal?: AbortSignal
  onDelta?: (content: string) => void
  modelMode?: "auto" | "plus" | "turbo" | "max"
  useBm25?: boolean
  useGraphRag?: boolean
  deepSearch?: boolean
  thinkingSearch?: boolean
}): Promise<{
  content: string
  sources: string[]
  conversationId: string | null
}> {
  const headers = getKnowledgeBaseAuthHeaders()
  const scope = input.scope
  const filePath = scope.filePath?.trim() || null
  const folderPath = scope.folderPath ?? null
  const filePaths = scope.filePaths?.filter(Boolean) ?? []
  const inlineDocuments = scope.inlineDocuments?.filter((doc) => doc.name && doc.text?.trim()) ?? []
  const history = (input.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .map((m) => ({ role: m.role, content: String(m.content).trim() }))

  const res = await fetch("/api/knowledge-base/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    signal: input.signal,
    body: JSON.stringify({
      question: input.question,
      folderPath,
      filePath: filePaths.length > 0 ? null : filePath,
      filePaths: filePaths.length > 0 ? filePaths : undefined,
      inlineDocuments: inlineDocuments.length > 0 ? inlineDocuments : undefined,
      history: history.length > 0 ? history : undefined,
      useBm25: input.useBm25 !== false,
      useGraphRag: input.useGraphRag === true,
      stream: true,
      modelMode: input.modelMode ?? "plus",
      deepSearch: input.deepSearch === true,
      thinkingSearch: input.thinkingSearch === true,
      conversationId: input.conversationId ?? null,
      title: scope.title || scope.fileName || scope.folderName || "全部资料",
      fileName: scope.fileName,
      folderName: scope.folderName || "全部资料",
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    let errMsg = `服务器错误 HTTP ${res.status}`
    try {
      errMsg = (JSON.parse(text) as { error?: string }).error || errMsg
    } catch { /* ignore */ }
    throw new Error(errMsg)
  }
  if (!res.body) throw new Error("无响应体")

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let sseBuffer = ""
  let content = ""
  let sources: string[] = []
  let conversationId: string | null = input.conversationId ?? null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    sseBuffer += decoder.decode(value, { stream: true })
    const parts = sseBuffer.split("\n\n")
    sseBuffer = parts.pop() ?? ""

    for (const part of parts) {
      if (!part.startsWith("data: ")) continue
      const jsonStr = part.slice(6).trim()
      if (jsonStr === "[DONE]") continue

      let event: KnowledgeChatStreamEvent | null = null
      try {
        event = JSON.parse(jsonStr) as KnowledgeChatStreamEvent
      } catch {
        continue
      }
      if (!event) continue

      if (event.type === "text" && event.delta) {
        content += event.delta
        input.onDelta?.(content)
      } else if (event.type === "done") {
        sources = event.sources ?? []
        conversationId = event.conversationId ?? conversationId
      } else if (event.type === "error") {
        throw new Error(event.message || "知识库问答失败")
      }
    }
  }

  return { content, sources, conversationId }
}

export function resolveKnowledgeChatScope(input: {
  pathname: string
  folderFromUrl?: string | null
  activeKbRelativePath?: string | null
  activeKbName?: string | null
  searchWholeLibrary?: boolean
}): KnowledgeChatScope {
  if (input.searchWholeLibrary) {
    return { folderPath: null, folderName: "全部资料", title: "全部资料" }
  }

  if (input.activeKbRelativePath) {
    return {
      filePath: input.activeKbRelativePath,
      fileName: input.activeKbName ?? undefined,
      title: input.activeKbName ?? input.activeKbRelativePath,
    }
  }

  if (input.pathname.includes("/ai-knowledge")) {
    const folder = input.folderFromUrl?.trim()
    if (folder) {
      const folderName = folder.split("/").filter(Boolean).pop() ?? folder
      return { folderPath: folder, folderName, title: folderName }
    }
  }

  return { folderPath: null, folderName: "全部资料", title: "全部资料" }
}

export function formatKnowledgeScopeLabel(scope: KnowledgeChatScope): string {
  if (scope.filePaths?.length || scope.inlineDocuments?.length) {
    if (scope.title) return scope.title
    const total = (scope.filePaths?.length ?? 0) + (scope.inlineDocuments?.length ?? 0)
    return total > 0 ? `侧栏 ${total} 个文件` : "侧栏文件"
  }
  if (scope.filePath) return scope.fileName || scope.filePath.split("/").pop() || "当前文件"
  if (scope.folderPath) return scope.folderName || scope.folderPath
  return "全部资料"
}
