import { Document } from "@langchain/core/documents"
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory"
import { collectKnowledgeBaseDocuments, getKnowledgeBaseFile, readFileDocumentText, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"
import { createHash } from "crypto"
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

type KnowledgeBaseIndexCacheEntry = {
  signature: string
  vectorStore: MemoryVectorStore
  indexedDocuments: number
  indexedChunks: number
}

// ── Disk persistence for vector index ────────────────────────────────────────

type FileFingerprint = {
  size: number
  updatedAt: string
}

type MemoryVectorRow = {
  content: string
  embedding: number[]
  metadata: Record<string, unknown>
}

type DiskIndexEntry = {
  version: 2
  scope: string
  model: string
  splitter: {
    chunkSize: number
    chunkOverlap: number
  }
  files: Record<string, FileFingerprint>
  indexedDocuments: number
  indexedChunks: number
  memoryVectors: MemoryVectorRow[]
  updatedAt: string
}

function getIndexCacheDir() {
  return getServerStoragePath("kb_index")
}

function indexCacheFilePath(cacheKey: string) {
  const hash = createHash("sha256").update(cacheKey).digest("hex").slice(0, 24)
  return path.join(getIndexCacheDir(), `${hash}.json`)
}

function normalizeLoadedDiskEntry(cacheKey: string, data: any): DiskIndexEntry | null {
  // Backward compatibility for v1 single-signature cache format
  if (data && data.signature && Array.isArray(data.memoryVectors)) {
    return {
      version: 2,
      scope: cacheKey === "__root__" ? "" : cacheKey,
      model: getEmbeddingModel(),
      splitter: { chunkSize: 1200, chunkOverlap: 180 },
      files: {},
      indexedDocuments: Number(data.indexedDocuments ?? 0),
      indexedChunks: Number(data.indexedChunks ?? 0),
      memoryVectors: data.memoryVectors,
      updatedAt: new Date().toISOString(),
    }
  }
  if (!data || data.version !== 2 || !Array.isArray(data.memoryVectors) || typeof data.files !== "object") {
    return null
  }
  return data as DiskIndexEntry
}

function loadDiskIndex(cacheKey: string): DiskIndexEntry | null {
  try {
    const file = indexCacheFilePath(cacheKey)
    if (!existsSync(file)) return null
    const raw = JSON.parse(readFileSync(file, "utf-8"))
    return normalizeLoadedDiskEntry(cacheKey, raw)
  } catch {
    return null
  }
}

function saveDiskIndex(cacheKey: string, entry: DiskIndexEntry) {
  try {
    mkdirSync(getIndexCacheDir(), { recursive: true })
    writeFileSync(indexCacheFilePath(cacheKey), JSON.stringify(entry))
  } catch {}
}

function deleteDiskIndex(cacheKey: string) {
  try {
    const file = indexCacheFilePath(cacheKey)
    if (existsSync(file)) rmSync(file)
  } catch {}
}

function computeSignatureFromFiles(files: Record<string, FileFingerprint>) {
  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([p, f]) => `${p}:${f.size}:${f.updatedAt}`)
    .join("|")
}

/** Clear both in-memory and on-disk vector index for a folder (or all if folderPath is null). */
export function invalidateVectorStoreCache(folderPath?: string | null) {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  const cache = getKnowledgeBaseIndexCache()
  if (!normalized) {
    cache.clear()
    try {
      const dir = getIndexCacheDir()
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch {}
    return
  }

  const cacheKey = normalized || "__root__"
  cache.delete(cacheKey)
  deleteDiskIndex(cacheKey)
}

const DASHSCOPE_EMBEDDING_BATCH_SIZE = 5

function getDashScopeApiKey() {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    throw new Error("缺少 DASHSCOPE_API_KEY，无法启用 AI 知识库问答")
  }
  return apiKey
}

function getDashScopeBaseUrl() {
  return process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
}

function getChatModel() {
  return process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus"
}

function getEmbeddingModel() {
  return process.env.DASHSCOPE_EMBEDDING_MODEL || "text-embedding-v3"
}

function createChatModel() {
  return new ChatOpenAI({
    apiKey: getDashScopeApiKey(),
    model: getChatModel(),
    temperature: 0.2,
    configuration: {
      baseURL: getDashScopeBaseUrl(),
    },
  })
}

function getKnowledgeBaseIndexCache() {
  const scope = globalThis as typeof globalThis & {
    __knowledgeBaseIndexCache?: Map<string, KnowledgeBaseIndexCacheEntry>
  }

  if (!scope.__knowledgeBaseIndexCache) {
    scope.__knowledgeBaseIndexCache = new Map<string, KnowledgeBaseIndexCacheEntry>()
  }

  return scope.__knowledgeBaseIndexCache
}

function getScopeLockMap() {
  const scope = globalThis as typeof globalThis & {
    __knowledgeBaseIndexLocks?: Map<string, Promise<void>>
  }
  if (!scope.__knowledgeBaseIndexLocks) {
    scope.__knowledgeBaseIndexLocks = new Map()
  }
  return scope.__knowledgeBaseIndexLocks
}

async function withScopeLock<T>(cacheKey: string, task: () => Promise<T>): Promise<T> {
  const locks = getScopeLockMap()
  const prev = locks.get(cacheKey) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  locks.set(cacheKey, prev.then(() => gate))

  await prev
  try {
    return await task()
  } finally {
    release()
    if (locks.get(cacheKey) === gate) {
      locks.delete(cacheKey)
    }
  }
}

function createIndexEmbeddingsModel() {
  return new OpenAIEmbeddings({
    apiKey: getDashScopeApiKey(),
    model: getEmbeddingModel(),
    batchSize: DASHSCOPE_EMBEDDING_BATCH_SIZE,
    // Serialize batches and retry with exponential backoff to avoid 429 rate limits
    maxConcurrency: 1,
    maxRetries: 6,
    configuration: {
      baseURL: getDashScopeBaseUrl(),
    },
  })
}

function createVectorStoreFromRows(rows: MemoryVectorRow[]) {
  const vectorStore = new MemoryVectorStore(
    new OpenAIEmbeddings({
      apiKey: getDashScopeApiKey(),
      model: getEmbeddingModel(),
      configuration: { baseURL: getDashScopeBaseUrl() },
    }),
  )
  ;(vectorStore as any).memoryVectors = rows
  return vectorStore
}

function buildFileFingerprintMap(
  sourceDocuments: Array<{ relativePath: string; size: number; updatedAt: string }>,
): Record<string, FileFingerprint> {
  const map: Record<string, FileFingerprint> = {}
  for (const doc of sourceDocuments) {
    map[doc.relativePath] = { size: doc.size, updatedAt: doc.updatedAt }
  }
  return map
}

function fingerprintChanged(next: FileFingerprint | undefined, prev: FileFingerprint | undefined) {
  if (!next || !prev) return true
  return next.size !== prev.size || next.updatedAt !== prev.updatedAt
}

async function getOrBuildVectorStore(folderPath: string) {
  const normalizedFolderPath = normalizeKnowledgeBasePath(folderPath)
  const cacheKey = normalizedFolderPath || "__root__"

  return withScopeLock(cacheKey, async () => {
    const sourceDocuments = await collectKnowledgeBaseDocuments(normalizedFolderPath)

    if (!sourceDocuments.length) {
      throw new Error("当前文件夹没有可用于问答的文档。支持 txt、md、json、csv、html、pdf。")
    }

    const nextFiles = buildFileFingerprintMap(sourceDocuments)
    const nextSignature = computeSignatureFromFiles(nextFiles)
    const cache = getKnowledgeBaseIndexCache()
    const inMemory = cache.get(cacheKey)
    if (inMemory && inMemory.signature === nextSignature) {
      return inMemory
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1200,
      chunkOverlap: 180,
    })

    const disk = loadDiskIndex(cacheKey)
    const prevFiles = disk?.files ?? {}

    const updatedOrAdded: string[] = []
    for (const [relativePath, fp] of Object.entries(nextFiles)) {
      if (fingerprintChanged(fp, prevFiles[relativePath])) {
        updatedOrAdded.push(relativePath)
      }
    }

    const deleted = new Set<string>()
    for (const relativePath of Object.keys(prevFiles)) {
      if (!nextFiles[relativePath]) {
        deleted.add(relativePath)
      }
    }

    const changed = new Set<string>([...updatedOrAdded, ...deleted])
    const baseRows = (disk?.memoryVectors ?? []).filter((row) => {
      const src = String(row?.metadata?.source || "")
      return src && !changed.has(src)
    })

    let appendedRows: MemoryVectorRow[] = []
    if (updatedOrAdded.length > 0) {
      const docMap = new Map(sourceDocuments.map((doc) => [doc.relativePath, doc]))
      const changedDocs = updatedOrAdded
        .map((p) => docMap.get(p))
        .filter((doc): doc is NonNullable<typeof docMap extends Map<any, infer V> ? V : never> => Boolean(doc))

      const splitInput = changedDocs.map(
        (document) =>
          new Document({
            pageContent: document.text,
            metadata: {
              source: document.relativePath,
              size: document.size,
              updatedAt: document.updatedAt,
            },
          }),
      )
      const splitDocuments = await splitter.splitDocuments(splitInput)
      if (splitDocuments.length > 0) {
        try {
          const partialStore = await MemoryVectorStore.fromDocuments(splitDocuments, createIndexEmbeddingsModel())
          appendedRows = ((partialStore as any).memoryVectors ?? []) as MemoryVectorRow[]
        } catch (err: any) {
          throw classifyApiError(err)
        }
      }
    }

    const mergedRows = [...baseRows, ...appendedRows]
    const vectorStore = createVectorStoreFromRows(mergedRows)

    const nextValue: KnowledgeBaseIndexCacheEntry = {
      signature: nextSignature,
      vectorStore,
      indexedDocuments: sourceDocuments.length,
      indexedChunks: mergedRows.length,
    }
    cache.set(cacheKey, nextValue)

    saveDiskIndex(cacheKey, {
      version: 2,
      scope: normalizedFolderPath,
      model: getEmbeddingModel(),
      splitter: { chunkSize: 1200, chunkOverlap: 180 },
      files: nextFiles,
      indexedDocuments: sourceDocuments.length,
      indexedChunks: mergedRows.length,
      memoryVectors: mergedRows,
      updatedAt: new Date().toISOString(),
    })

    return nextValue
  })
}

export async function syncVectorStoreForScope(folderPath?: string | null) {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  const index = await getOrBuildVectorStore(normalized)
  return {
    scope: normalized || "",
    indexedDocuments: index.indexedDocuments,
    indexedChunks: index.indexedChunks,
  }
}

/** Detect DashScope/OpenAI-style errors and rethrow with a Chinese-friendly message. */
function classifyApiError(err: unknown): Error {
  const msg = String((err as any)?.message || err || "")
  const status = (err as any)?.status ?? (err as any)?.response?.status ?? 0
  if (status === 429 || msg.includes("429") || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("quota")) {
    return new Error(
      "AI 接口调用频率超限（429）。原因可能是：①知识库文件较多、分块数量大，单次构建索引耗尽速率配额；②账号当前套餐额度已用完。" +
      "\n建议：①切换到具体子文件夹提问（而非全部资料）；②稍等片刻后重试；③检查 DashScope 控制台账单与用量配额。"
    )
  }
  return err instanceof Error ? err : new Error(msg || "AI 接口调用失败")
}

function extractTokenUsage(response: { usage_metadata?: unknown; response_metadata?: unknown }): { inputTokens: number; outputTokens: number; totalTokens: number } {
  // LangChain AIMessage exposes usage_metadata (preferred) or response_metadata.token_usage
  const meta: Record<string, unknown> =
    (response.usage_metadata as Record<string, unknown>) ||
    ((response.response_metadata as Record<string, unknown>)?.token_usage as Record<string, unknown>) ||
    {}
  return {
    inputTokens: Number(meta.input_tokens ?? meta.prompt_tokens ?? 0),
    outputTokens: Number(meta.output_tokens ?? meta.completion_tokens ?? 0),
    totalTokens: Number(meta.total_tokens ?? 0) ||
      (Number(meta.input_tokens ?? meta.prompt_tokens ?? 0) + Number(meta.output_tokens ?? meta.completion_tokens ?? 0)),
  }
}

function tokenizeForBm25(text: string) {
  const lowered = text.toLowerCase()
  const terms = lowered.match(/[\u4e00-\u9fff]|[a-z0-9_]+/g) || []
  return terms.filter((term) => term.trim().length > 0)
}

function bm25RankChunks(
  query: string,
  rows: MemoryVectorRow[],
  topK = 4,
): Document[] {
  if (!rows.length) return []

  const docs = rows.map((row) => {
    const content = String(row.content || "")
    const terms = tokenizeForBm25(content)
    const tf = new Map<string, number>()
    for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1)
    return { row, tf, len: terms.length }
  })

  const queryTerms = tokenizeForBm25(query)
  if (!queryTerms.length) return []

  const uniqueQueryTerms = Array.from(new Set(queryTerms))
  const N = docs.length
  const avgdl = docs.reduce((sum, d) => sum + d.len, 0) / Math.max(N, 1)
  const k1 = 1.5
  const b = 0.75

  const dfs = new Map<string, number>()
  for (const term of uniqueQueryTerms) {
    let df = 0
    for (const d of docs) {
      if (d.tf.has(term)) df += 1
    }
    dfs.set(term, df)
  }

  const scored = docs
    .map((d) => {
      let score = 0
      for (const term of uniqueQueryTerms) {
        const f = d.tf.get(term) || 0
        if (!f) continue
        const df = dfs.get(term) || 0
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
        const denom = f + k1 * (1 - b + b * (d.len / Math.max(avgdl, 1)))
        score += idf * ((f * (k1 + 1)) / Math.max(denom, 1e-9))
      }
      return { d, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return scored.map(({ d }) =>
    new Document({
      pageContent: String(d.row.content || ""),
      metadata: d.row.metadata || {},
    }),
  )
}

function stringifyModelContent(content: unknown) {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item
        }

        if (item && typeof item === "object" && "text" in item) {
          return String(item.text || "")
        }

        return ""
      })
      .join("\n")
      .trim()
  }

  return String(content || "")
}

export async function askKnowledgeBaseQuestion(input: {
  question: string
  folderPath?: string | null
  filePath?: string | null
  useBm25?: boolean
}) {
  const question = input.question.trim()
  if (!question) {
    throw new Error("请输入问题")
  }
  const enableBm25 = input.useBm25 !== false

  const model = createChatModel()

  // ── Single-file mode: skip vector store, feed the whole file as context ──
  if (input.filePath) {
    const file = await getKnowledgeBaseFile(input.filePath)
    const text = await readFileDocumentText(file.absolutePath, file.extension)
    const scopeLabel = file.relativePath
    const response = await model.invoke([
      {
        role: "system",
        content: text
          ? "你是市场研究知识库助手。只允许基于提供的资料回答问题。如果资料里没有足够依据，直接明确说明不知道或资料不足，不要编造。回答使用中文。"
          : "你是市场研究助手。该文档内容为空或暂不支持提取文字。请告知用户无法解读该文件内容。回答使用中文。",
      },
      {
        role: "user",
        content: text
          ? `当前检索范围：${scopeLabel}\n\n问题：${question}\n\n文件内容：\n${text}`
          : `当前检索范围：${scopeLabel}\n\n问题：${question}\n\n文件内容为空，无法作答。`,
      },
    ])
    return {
      answer: stringifyModelContent(response.content),
      sources: [file.relativePath],
      indexedDocuments: 1,
      indexedChunks: 1,
      tokenUsage: extractTokenUsage(response),
      model: getChatModel(),
    }
  }

  // ── Folder mode: vector-store similarity search ──
  const folderPath = normalizeKnowledgeBasePath(input.folderPath)
  let index: KnowledgeBaseIndexCacheEntry | null = null
  let matches: Document[] = []

  try {
    index = await getOrBuildVectorStore(folderPath)
    const denseMatches = await index.vectorStore.similaritySearch(question, 4)
    const rows = (((index.vectorStore as any).memoryVectors || []) as MemoryVectorRow[])
    const bm25Matches = enableBm25 ? bm25RankChunks(question, rows, 4) : []

    // Hybrid fusion: dense + BM25 lexical, de-duplicate by source+content prefix.
    const merged = [...denseMatches, ...bm25Matches]
    const seen = new Set<string>()
    matches = []
    for (const m of merged) {
      const source = String(m.metadata?.source || "")
      const key = `${source}|${m.pageContent.slice(0, 120)}`
      if (seen.has(key)) continue
      seen.add(key)
      matches.push(m)
      if (matches.length >= 6) break
    }
  } catch (error: any) {
    const msg = String(error?.message || error)
    if (!msg.includes("没有可用于问答的文档")) {
      throw classifyApiError(error)
    }
  }

  const context = matches
    .map((match, indexNumber) => {
      const source = String(match.metadata?.source || "未知来源")
      return `资料 ${indexNumber + 1} (${source})\n${match.pageContent}`
    })
    .join("\n\n")

  const response = await model.invoke([
    {
      role: "system",
      content:
        matches.length > 0
          ? "你是市场研究知识库助手。只允许基于提供的资料回答问题。如果资料里没有足够依据，直接明确说明不知道或资料不足，不要编造。回答使用中文，并在结尾列出引用到的文件路径。"
          : "你是市场研究助手。当前本地知识库为空，因此本轮回答不引用本地资料。你可以直接回答用户的问题，但需要明确说明当前没有本地文档可供检索。回答使用中文。",
    },
    {
      role: "user",
      content:
        matches.length > 0
          ? `当前检索范围：${folderPath || "全部资料"}\n\n问题：${question}\n\n参考资料：\n${context}`
          : `当前检索范围：${folderPath || "全部资料"}\n\n问题：${question}\n\n当前知识库目录为空，请直接基于通用能力回答，并提醒用户尚未上传资料。`,
    },
  ])

  const sources = Array.from(
    new Set(matches.map((match) => String(match.metadata?.source || "")).filter(Boolean)),
  )

  return {
    answer: stringifyModelContent(response.content),
    sources,
    indexedDocuments: index?.indexedDocuments ?? 0,
    indexedChunks: index?.indexedChunks ?? 0,
    tokenUsage: extractTokenUsage(response),
    model: getChatModel(),
  }
}