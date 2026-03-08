import { Document } from "@langchain/core/documents"
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory"
import { collectKnowledgeBaseDocuments, getKnowledgeBaseFile, readFileDocumentText, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"

type KnowledgeBaseIndexCacheEntry = {
  signature: string
  vectorStore: MemoryVectorStore
  indexedDocuments: number
  indexedChunks: number
}

const DASHSCOPE_EMBEDDING_BATCH_SIZE = 10

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

async function getOrBuildVectorStore(folderPath: string) {
  const normalizedFolderPath = normalizeKnowledgeBasePath(folderPath)
  const sourceDocuments = await collectKnowledgeBaseDocuments(normalizedFolderPath)

  if (!sourceDocuments.length) {
    throw new Error("当前文件夹没有可用于问答的文档。支持 txt、md、json、csv、html、pdf。")
  }

  const signature = sourceDocuments
    .map((document) => `${document.relativePath}:${document.size}:${document.updatedAt}`)
    .join("|")

  const cacheKey = normalizedFolderPath || "__root__"
  const cache = getKnowledgeBaseIndexCache()
  const existing = cache.get(cacheKey)
  if (existing && existing.signature === signature) {
    return existing
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1200,
    chunkOverlap: 180,
  })

  const documents = sourceDocuments.map(
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

  const splitDocuments = await splitter.splitDocuments(documents)
  const embeddings = new OpenAIEmbeddings({
    apiKey: getDashScopeApiKey(),
    model: getEmbeddingModel(),
    batchSize: DASHSCOPE_EMBEDDING_BATCH_SIZE,
    configuration: {
      baseURL: getDashScopeBaseUrl(),
    },
  })

  const vectorStore = await MemoryVectorStore.fromDocuments(splitDocuments, embeddings)
  const nextValue = {
    signature,
    vectorStore,
    indexedDocuments: sourceDocuments.length,
    indexedChunks: splitDocuments.length,
  }

  cache.set(cacheKey, nextValue)
  return nextValue
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

export async function askKnowledgeBaseQuestion(input: { question: string; folderPath?: string | null; filePath?: string | null }) {
  const question = input.question.trim()
  if (!question) {
    throw new Error("请输入问题")
  }

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
    }
  }

  // ── Folder mode: vector-store similarity search ──
  const folderPath = normalizeKnowledgeBasePath(input.folderPath)
  let index: KnowledgeBaseIndexCacheEntry | null = null
  let matches: Document[] = []

  try {
    index = await getOrBuildVectorStore(folderPath)
    matches = await index.vectorStore.similaritySearch(question, 6)
  } catch (error: any) {
    if (!String(error?.message || error).includes("没有可用于问答的文档")) {
      throw error
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
  }
}