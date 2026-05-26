import { Document } from "@langchain/core/documents"
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory"
import { collectKnowledgeBaseDocuments, getKnowledgeBaseFile, readFileDocumentText, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"
import {
  type FileFingerprint,
  type MemoryVectorRow,
  type Bm25PreIndex,
  type GraphIndex,
  EMPTY_BM25_INDEX,
  EMPTY_GRAPH_INDEX,
  PG_VECTOR_IN_MEM_MAX,
  PG_BM25_MAX,
  PG_GRAPH_MAX,
  pgLoadFingerprints,
  pgCountChunks,
  pgLoadRows,
  pgDeleteChunksBySource,
  pgDeleteScopeChunks,
  pgUpsertFileChunks,
  pgVectorSearch,
  pgGetIndexInfo,
  pgLoadBm25Index,
  pgSaveBm25Index,
  pgDeleteBm25Index,
  pgLoadGraphIndex,
  pgSaveGraphIndex,
  pgDeleteGraphIndex,
  pgLoadLLMEntityCache,
  pgSaveLLMEntityEntries,
  pgDeleteLLMEntityCache,
} from "@/lib/server/knowledge-pg"

type KnowledgeBaseIndexCacheEntry = {
  signature: string
  vectorStore: MemoryVectorStore
  indexedDocuments: number
  indexedChunks: number
  bm25Index: Bm25PreIndex
  graphIndex: GraphIndex
}

// ── Graph term extraction ─────────────────────────────────────────────────────

// Common Chinese surnames for person-name detection heuristic
const ZH_SURNAMES = new Set([
  "王","李","张","刘","陈","杨","黄","赵","吴","周","徐","孙","马","朱","胡","郭","何","高","林","罗",
  "郑","梁","谢","宋","唐","许","韩","冯","邓","曹","彭","曾","肖","田","董","袁","潘","于","蒋","蔡",
  "余","杜","叶","程","魏","苏","吕","丁","任","沈","姚","卢","傅","钟","姜","崔","谭","廖","范","汪",
  "陆","金","石","戴","贾","韦","夏","邱","方","侯","邹","熊","孟","秦","白","江","阎","薛","尹","段",
  "雷","黎","史","龙","陶","贺","顾","毛","郝","龚","邵","万","钱","严","覃","武","戚","莫","孔","向",
])

// Filler words / particles that are never meaningful entities
const ZH_GRAPH_STOP = new Set([
  "我们","你们","他们","她们","它们","自己","大家","各位","这个","那个","这些","那些","一个","哪个","哪些",
  "这里","那里","这样","那样","什么","怎么","为什么","这么","那么","如此","其他","别的","其余",
  "因此","所以","但是","然而","不过","虽然","尽管","而且","并且","另外","此外","同时","其次","首先",
  "然后","接下来","最后","总之","综上","换言之","也就是","就是说","也就是说","的话",
  "可以","需要","应该","必须","能够","可能","已经","将会","会有","有所","有些","有的","有着",
  "进行","通过","使用","利用","借助","基于","依据","按照","结合","围绕",
  "问题","情况","方面","方式","方法","内容","方向","目标","结果","过程","作用","意义","价值","体系",
  "工作","管理","服务","模式","机制","系统","平台","项目","计划","方案","措施","策略",
  "发展","变化","影响","效果","进展","现状","趋势","特点","特征","优势","不足","挑战",
  "分析","研究","探讨","探索","讨论","说明","介绍","阐述","描述","解释","提出","提到",
  "表示","认为","指出","显示","表明","体现","反映","发现","看到","了解","知道","认识",
  "实现","获得","取得","达到","完成","建立","形成","产生","带来","促进","推动","加强",
  "提高","增加","减少","降低","扩大","缩小","调整","优化","改善","改变","完善",
  "整体","总体","主要","基本","整个","整合","全面","全部","全体","一般","普通",
  "相关","相应","对应","配套","涉及","包括","包含","涵盖","覆盖","适用","针对",
  "根据","对于","关于","由于","出于","为了","以便","以期","旨在",
  "目前","当前","现在","当下","近期","近年","今年","去年","明年","最近","此前","此后",
  "国家","全球","中国","国内","国际","境内","境外","各地","各类","各种",
  "企业","公司","机构","单位","部门","组织","协会","委员会","管理层",
  "经济","政策","市场","行业","领域","板块","指数","数据","报告","信息",
  "没有","不是","不能","不会","不到","不了","不得","不再","不仅","不过",
  "一下","一点","一些","一定","一般","一直","一起","一共","一样","一致",
  "应当","比较","相比","对比","高于","低于","多于","少于","大于","小于",
  "其中","之中","之间","之前","之后","以上","以下","以内","以外","以及",
  "开始","结束","继续","停止","保持","维持","坚持","确保","保证","避免",
  "如果","假设","即使","除非","只要","只有","一旦","万一","不管","无论",
  "具体","实际","真实","正式","明确","清楚","重要","关键","核心","基础",
  "今天","昨天","明天","本月","上月","下月","本季","季度","上半年","下半年",
  "您好","谢谢","感谢","请问","麻烦","注意","当然","确实","显然","明显",
])

// Company/org suffixes that signal a named entity worth keeping
const COMPANY_SUFFIXES = [
  "有限公司","股份公司","责任公司","合伙企业","投资公司","管理公司","基金公司","资产管理",
  "投资管理","基金管理","证券公司","期货公司","信托公司","资产公司","咨询公司","顾问公司",
  "科技公司","集团有限","有限合伙","私募基金","证券投资","股权投资","基金服务","托管银行",
]

// Fund product name: e.g. 某某某私募基金X期, 某FOF组合一号
const FUND_PRODUCT_PATTERN = /[\u4e00-\u9fff\uFF00-\uFFEF\w]{4,20}(?:基金|私募|FOF|产品|组合|计划|专项|定增|套利)[\u4e00-\u9fff\uFF00-\uFFEF\w]{0,8}(?:第?[一二三四五六七八九十百\d]+期)?/g
const FUND_SERIAL_PATTERN = /[\u4e00-\u9fff\uFF00-\uFFEF\w]{4,18}(?:第?[一二三四五六七八九十百\d]+(?:期|号|季))/g

// Person name heuristics: title precedes or follows a 2-3-char Chinese name
const PERSON_TITLE_BEFORE = /(?:总经理|副总经理|董事长|执行董事|独立董事|基金经理|投资经理|研究员|首席分析师|分析师|合伙人|联合创始人|创始人|CEO|CIO|CFO|总裁|主席|监事|督察长|风控总监)\s*([\u4e00-\u9fff]{2,4})/g
const PERSON_TITLE_AFTER = /([\u4e00-\u9fff]{2,4})\s*(?:总经理|副总经理|董事长|执行董事|独立董事|基金经理|投资经理|研究员|首席分析师|分析师|合伙人|联合创始人|创始人|总裁|主席|先生|女士|博士|教授|监事)/g

/** Extract named entities from text: fund companies, fund products, and people. */
function extractGraphTerms(text: string): string[] {
  const terms = new Set<string>()

  // ── 1. Company / org names (longest-match on suffix list) ─────────────────
  for (const suffix of COMPANY_SUFFIXES) {
    const re = new RegExp(`[\\u4e00-\\u9fff\\uFF00-\\uFFEF\\w]{2,15}${suffix}`, "g")
    for (const m of text.matchAll(re)) {
      const t = m[0].trim()
      if (t.length >= 5 && t.length <= 35) terms.add(t)
    }
  }

  // ── 2. Fund product names ────────────────────────────────────────────────
  for (const m of text.matchAll(FUND_PRODUCT_PATTERN)) {
    const t = m[0].trim()
    if (t.length >= 4) terms.add(t)
  }
  for (const m of text.matchAll(FUND_SERIAL_PATTERN)) {
    const t = m[0].trim()
    if (t.length >= 4) terms.add(t)
  }

  // ── 3. Person names (title-anchored, surname-validated) ──────────────────
  for (const m of text.matchAll(PERSON_TITLE_BEFORE)) {
    const name = m[1]?.trim()
    if (name && ZH_SURNAMES.has(name[0])) terms.add(name)
  }
  for (const m of text.matchAll(PERSON_TITLE_AFTER)) {
    const name = m[1]?.trim()
    if (name && ZH_SURNAMES.has(name[0])) terms.add(name)
  }

  // ── 4. English acronyms / proper nouns ───────────────────────────────────
  const en = text.match(/\b(?:[A-Z]{2,}|[A-Z][a-z]{2,}(?:[A-Z][a-zA-Z0-9]*)+)\b/g) || []
  for (const t of en) terms.add(t)

  return Array.from(terms)
}

/** Build a lightweight co-occurrence graph index from vector rows. */
function buildGraphIndex(rows: MemoryVectorRow[], signature: string): GraphIndex {
  const N = rows.length
  if (N === 0) {
    return { version: 1, signature, termChunks: {}, chunkTerms: [], numChunks: 0, updatedAt: new Date().toISOString() }
  }

  const rawChunkTerms: string[][] = new Array(N)
  const termDocFreq: Record<string, number> = {}

  // Pass 1: extract terms per chunk, measure document frequency
  for (let i = 0; i < N; i++) {
    const terms = extractGraphTerms(String(rows[i].content || ""))
    const unique = Array.from(new Set(terms))
    rawChunkTerms[i] = unique
    for (const t of unique) termDocFreq[t] = (termDocFreq[t] || 0) + 1
  }

  // Keep terms that appear in 1..50% of chunks.
  // minDf=1 so rare but specific named entities (fund products, people) are retained.
  // maxDf caps truly ubiquitous terms that would create unhelpfully dense edges.
  const minDf = 1
  const maxDf = Math.max(2, Math.floor(N * 0.50))

  const termChunks: Record<string, number[]> = {}
  const chunkTerms: string[][] = new Array(N)

  for (let i = 0; i < N; i++) {
    const filtered: string[] = []
    for (const t of rawChunkTerms[i]) {
      const df = termDocFreq[t] || 0
      if (df >= minDf && df <= maxDf) {
        filtered.push(t)
        if (!termChunks[t]) termChunks[t] = []
        termChunks[t].push(i)
      }
    }
    chunkTerms[i] = filtered
  }

  return { version: 1, signature, termChunks, chunkTerms, numChunks: N, updatedAt: new Date().toISOString() }
}

/** Expand seed chunk indices via the graph, returning additional relevant Documents. */
function graphExpandContext(
  question: string,
  allRows: MemoryVectorRow[],
  seedIndices: number[],
  graph: GraphIndex,
  topK = 4,
): Document[] {
  const seedSet = new Set(seedIndices)
  const candidateScore: Map<number, number> = new Map()

  // 1. Expand via question terms hitting the graph
  const qTerms = extractGraphTerms(question)
  for (const term of qTerms) {
    const linked = graph.termChunks[term] || []
    for (const idx of linked) {
      if (!seedSet.has(idx)) candidateScore.set(idx, (candidateScore.get(idx) || 0) + 2)
    }
  }

  // 2. 1-hop expansion: terms from seed chunks → connected chunks
  for (const sIdx of seedIndices) {
    const sTerms = graph.chunkTerms[sIdx] || []
    for (const term of sTerms) {
      const linked = graph.termChunks[term] || []
      for (const idx of linked) {
        if (!seedSet.has(idx)) candidateScore.set(idx, (candidateScore.get(idx) || 0) + 1)
      }
    }
  }

  if (!candidateScore.size) return []

  return Array.from(candidateScore.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([idx]) =>
      new Document({
        pageContent: String(allRows[idx]?.content || ""),
        metadata: { ...(allRows[idx]?.metadata || {}), graphExpanded: true },
      }),
    )
}

// ── BM25 pre-computed inverted index ─────────────────────────────────────────


function computeSignatureFromFiles(files: Record<string, FileFingerprint>) {
  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([p, f]) => `${p}:${f.size}:${f.updatedAt}`)
    .join("|")
}

/** Clear in-memory cache and PG-stored indexes for a folder (or all scopes if folderPath is null). */
export async function invalidateVectorStoreCache(folderPath?: string | null): Promise<void> {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  const cache = getKnowledgeBaseIndexCache()
  if (!normalized) {
    cache.clear()
    await Promise.allSettled([
      pgDeleteScopeChunks(null),
      pgDeleteBm25Index(null),
      pgDeleteGraphIndex(null),
      pgDeleteLLMEntityCache(null),
    ])
    return
  }
  cache.delete(normalized)
  await Promise.allSettled([
    pgDeleteScopeChunks(normalized),
    pgDeleteBm25Index(normalized),
    pgDeleteGraphIndex(normalized),
    pgDeleteLLMEntityCache(normalized),
  ])
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

// ── Model catalogue ───────────────────────────────────────────────────────────

/** Canonical IDs accepted by both frontend and API route. */
export type KbModelMode = "auto" | "plus" | "turbo"

const MODEL_IDS: Record<Exclude<KbModelMode, "auto">, string> = {
  plus: "qwen-plus",
  turbo: "qwen-turbo",
}

/** Returns the DashScope model ID to use given the mode. */
export function selectModelForQuestion(mode: KbModelMode): string {
  if (mode === "turbo") return MODEL_IDS.turbo
  return MODEL_IDS.plus
}

function createChatModel(modelId: string) {
  return new ChatOpenAI({
    apiKey: getDashScopeApiKey(),
    model: modelId,
    temperature: 0.2,
    streaming: true,
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

async function getOrBuildVectorStore(
  folderPath: string,
  onProgress?: (done: number, total: number, file: string) => void,
) {
  const normalizedFolderPath = normalizeKnowledgeBasePath(folderPath)
  const cacheKey = normalizedFolderPath || "__root__"
  const scopeKey = normalizedFolderPath || ""

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

    // Load file fingerprints from PG (replaces JSON disk index)
    const prevFiles = await pgLoadFingerprints(scopeKey)

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

    // Remove deleted files from PG
    if (deleted.size > 0) {
      await pgDeleteChunksBySource(scopeKey, [...deleted])
    }

    // Embed updated/added files and upsert chunks into PG
    if (updatedOrAdded.length > 0) {
      const docMap = new Map(sourceDocuments.map((doc) => [doc.relativePath, doc]))
      const changedDocs = updatedOrAdded
        .map((p) => docMap.get(p))
        .filter((doc): doc is NonNullable<typeof docMap extends Map<any, infer V> ? V : never> => Boolean(doc))

      const embeddingsModel = createIndexEmbeddingsModel()
      for (let i = 0; i < changedDocs.length; i++) {
        const doc = changedDocs[i]
        const fileDoc = new Document({
          pageContent: doc.text,
          metadata: { source: doc.relativePath, size: doc.size, updatedAt: doc.updatedAt },
        })
        const chunks = await splitter.splitDocuments([fileDoc])
        if (chunks.length > 0) {
          try {
            const partStore = await MemoryVectorStore.fromDocuments(chunks, embeddingsModel)
            const newRows = (partStore as any).memoryVectors as MemoryVectorRow[]
            await pgUpsertFileChunks(scopeKey, doc.relativePath, newRows, nextFiles[doc.relativePath], getEmbeddingModel())
          } catch (err: any) {
            throw classifyApiError(err)
          }
        }
        onProgress?.(i + 1, changedDocs.length, doc.relativePath)
      }
    }

    const changed = new Set<string>([...updatedOrAdded, ...deleted])

    // Determine total chunk count after all updates
    const totalChunks = await pgCountChunks(scopeKey)

    // Small scopes: load embeddings into RAM → MemoryVectorStore for fast in-process search
    // Large scopes: skip loading vectors into Node.js → PG HNSW handles vector queries
    const needEmbeddings = totalChunks <= PG_VECTOR_IN_MEM_MAX
    // Mid-size scopes still need text content for BM25 and graph RAG
    const needContentRows = totalChunks <= Math.max(PG_BM25_MAX, PG_GRAPH_MAX)

    let mergedRows: MemoryVectorRow[] = []
    if (needEmbeddings) {
      mergedRows = await pgLoadRows(scopeKey, { includeEmbeddings: true })
    } else if (needContentRows) {
      mergedRows = await pgLoadRows(scopeKey, { includeEmbeddings: false })
    }

    // Empty MemoryVectorStore signals: use PG HNSW for vector search
    const vectorStore = needEmbeddings
      ? createVectorStoreFromRows(mergedRows)
      : createVectorStoreFromRows([])

    // BM25 index — only built/loaded for scopes within threshold
    let bm25Index: Bm25PreIndex
    if (totalChunks <= PG_BM25_MAX) {
      if (changed.size > 0) {
        const rowsForBm25 = mergedRows.length > 0 ? mergedRows : await pgLoadRows(scopeKey, { includeEmbeddings: false })
        bm25Index = buildBm25Index(rowsForBm25)
        await pgSaveBm25Index(scopeKey, bm25Index)
      } else {
        bm25Index = (await pgLoadBm25Index(scopeKey)) ?? buildBm25Index(mergedRows)
      }
    } else {
      bm25Index = EMPTY_BM25_INDEX
    }

    // Graph RAG index — only built/loaded for scopes within threshold
    let graphIndex: GraphIndex
    if (totalChunks <= PG_GRAPH_MAX) {
      const pgGraph = await pgLoadGraphIndex(scopeKey)
      if (pgGraph?.signature !== nextSignature) {
        const rowsForGraph = mergedRows.length > 0 ? mergedRows : await pgLoadRows(scopeKey, { includeEmbeddings: false })
        graphIndex = buildGraphIndex(rowsForGraph, nextSignature)
        await pgSaveGraphIndex(scopeKey, graphIndex)
      } else {
        graphIndex = pgGraph
      }
    } else {
      graphIndex = EMPTY_GRAPH_INDEX
    }

    const nextValue: KnowledgeBaseIndexCacheEntry = {
      signature: nextSignature,
      vectorStore,
      indexedDocuments: sourceDocuments.length,
      indexedChunks: totalChunks,
      bm25Index,
      graphIndex,
    }
    cache.set(cacheKey, nextValue)
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

// ── Graph visualization data export ──────────────────────────────────────────

export type GraphVizNode = { id: string; name: string; category: "document" | "company" | "fund" | "person" | "other"; value: number }
export type GraphVizLink = { source: string; target: string; value: number }
export type GraphVizData = { nodes: GraphVizNode[]; links: GraphVizLink[] }

function classifyEntityCategory(term: string): GraphVizNode["category"] {
  if (/(?:有限公司|股份公司|责任公司|合伙企业|集团有限|管理公司|基金公司|咨询公司|顾问公司|科技公司|证券公司|期货公司|信托公司|银行|券商)/.test(term)) return "company"
  if (/(?:基金|私募|FOF|产品|组合|计划|专项|定增|套利|第?[一二三四五六七八九十百\d]+(?:期|号|季))/.test(term)) return "fund"
  if (term.length <= 4 && ZH_SURNAMES.has(term[0])) return "person"
  return "other"
}

/**
 * Returns nodes and edges suitable for an ECharts graph (force-directed).
 * Entity categories: document (file), company (管理人/GP), fund (产品), person (基金经理 etc.), other.
 */
export async function getGraphVizData(folderPath?: string | null, maxTerms = 200): Promise<GraphVizData> {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  const index = await getOrBuildVectorStore(normalized)
  const graph = index.graphIndex
  const rows = (((index.vectorStore as any).memoryVectors || []) as MemoryVectorRow[])

  // Sort terms by document frequency (how many chunks reference them), take top maxTerms
  const termsByFreq = Object.entries(graph.termChunks)
    .map(([term, indices]) => ({ term, df: indices.length }))
    .sort((a, b) => b.df - a.df)
    .slice(0, maxTerms)

  // Build unique document list from row metadata
  const docSet = new Set<string>()
  for (const row of rows) {
    const src = String(row.metadata?.source || "")
    if (src) docSet.add(src)
  }

  const nodes: GraphVizNode[] = []

  for (const doc of docSet) {
    const shortName = doc.split("/").pop() || doc
    nodes.push({ id: `doc:${doc}`, name: shortName, category: "document", value: 3 })
  }

  for (const { term, df } of termsByFreq) {
    nodes.push({ id: `term:${term}`, name: term, category: classifyEntityCategory(term), value: Math.min(df, 12) })
  }

  // Links: term → each document containing it
  const edgeKey = new Set<string>()
  const links: GraphVizLink[] = []

  for (const { term } of termsByFreq) {
    const chunkIndices = graph.termChunks[term] || []
    const docsSeen = new Set<string>()
    for (const idx of chunkIndices) {
      const src = String(rows[idx]?.metadata?.source || "")
      if (!src || docsSeen.has(src)) continue
      docsSeen.add(src)
      const key = `term:${term}||doc:${src}`
      if (!edgeKey.has(key)) {
        edgeKey.add(key)
        links.push({ source: `term:${term}`, target: `doc:${src}`, value: 1 })
      }
    }
  }

  return { nodes, links }
}

// ── LLM-based structured entity extraction (for AI-enhanced graph) ────────────

export type FundDocumentEntities = {
  company: string | null
  products: string[]
  strategies: string[]
  team: Array<{ name: string; role: string }>
}


const ENTITY_EXTRACTION_PROMPT = `你是一个私募基金信息提取引擎，专门处理中文私募基金路演/介绍材料。

从以下材料中提取下列信息，以纯JSON格式输出，不要任何说明、代码块标记或额外内容：

{
  "company": "基金管理公司全称（如：XX资产管理有限公司）。若无法确定填null",
  "products": ["基金产品名称1", "基金产品名称2"],
  "strategies": ["策略标签"],
  "team": [{"name": "人名", "role": "职位"}]
}

策略标签须简短（4-8字），从材料中归纳，例如：量化多头、趋势CTA、主观多空、市场中性、股票对冲、债券套利、宏观对冲、FOF组合、高频量化、基本面量化、商品CTA、期权策略、转债策略、多策略混合等。

材料内容（前4000字）：
`

async function extractFundEntitiesFromDoc(
  text: string,
  relativePath: string,
): Promise<FundDocumentEntities> {
  const truncated = text.slice(0, 4000)
  const model = new ChatOpenAI({
    apiKey: getDashScopeApiKey(),
    model: MODEL_IDS.plus,
    temperature: 0,
    streaming: false,
    configuration: { baseURL: getDashScopeBaseUrl() },
  })

  let raw = ""
  try {
    const resp = await model.invoke([
      { role: "user", content: ENTITY_EXTRACTION_PROMPT + truncated },
    ])
    raw = stringifyModelContent(resp.content).trim()
  } catch {
    return { company: null, products: [], strategies: [], team: [] }
  }

  // Strip markdown code fences if present
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
  try {
    const parsed = JSON.parse(jsonStr)
    return {
      company: typeof parsed.company === "string" && parsed.company ? parsed.company : null,
      products: Array.isArray(parsed.products) ? parsed.products.filter((p: unknown) => typeof p === "string" && p) : [],
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies.filter((s: unknown) => typeof s === "string" && s) : [],
      team: Array.isArray(parsed.team)
        ? parsed.team
            .filter((m: unknown) => m && typeof (m as any).name === "string")
            .map((m: any) => ({ name: String(m.name || "").trim(), role: String(m.role || "").trim() }))
            .filter((m: { name: string; role: string }) => m.name.length >= 2)
        : [],
    }
  } catch {
    return { company: null, products: [], strategies: [], team: [] }
  }
}

export type LLMGraphVizNode = {
  id: string
  name: string
  category: "document" | "company" | "product" | "strategy" | "person"
  value: number
  detail?: string
}
export type LLMGraphVizLink = { source: string; target: string; relation: string }
export type LLMGraphVizData = {
  nodes: LLMGraphVizNode[]
  links: LLMGraphVizLink[]
  docResults: Array<{ relativePath: string; entities: FundDocumentEntities }>
}

/**
 * LLM-enhanced graph: calls the LLM on each document to extract fund company,
 * products, strategies, and team members, then builds a rich knowledge graph.
 * Results are disk-cached per file fingerprint; only changed files are re-extracted.
 */
export async function getGraphVizDataLLM(
  folderPath?: string | null,
  onProgress?: (done: number, total: number, file: string) => void,
): Promise<LLMGraphVizData> {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  const scopeKey = normalized || ""

  // Load all documents in scope
  const sourceDocs = await collectKnowledgeBaseDocuments(normalized)
  if (!sourceDocs.length) {
    return { nodes: [], links: [], docResults: [] }
  }

  const cachedFiles = await pgLoadLLMEntityCache(scopeKey)

  const updatedCache: Record<string, { size: number; updatedAt: string; entities: FundDocumentEntities }> = {}
  const docResults: Array<{ relativePath: string; entities: FundDocumentEntities }> = []

  for (let i = 0; i < sourceDocs.length; i++) {
    const doc = sourceDocs[i]
    const prev = cachedFiles[doc.relativePath]
    const unchanged = prev && prev.size === doc.size && prev.updatedAt === doc.updatedAt

    let entities: FundDocumentEntities
    if (unchanged) {
      entities = prev.entities
    } else {
      onProgress?.(i, sourceDocs.length, doc.relativePath)
      entities = await extractFundEntitiesFromDoc(doc.text, doc.relativePath)
      // Small delay to respect rate limits
      await new Promise((r) => setTimeout(r, 200))
    }

    updatedCache[doc.relativePath] = { size: doc.size, updatedAt: doc.updatedAt, entities }
    docResults.push({ relativePath: doc.relativePath, entities })
  }

  onProgress?.(sourceDocs.length, sourceDocs.length, "")

  // Persist updated cache
  await pgSaveLLMEntityEntries(scopeKey, updatedCache)

  // ── Build graph ─────────────────────────────────────────────────────────────
  const nodes: LLMGraphVizNode[] = []
  const links: LLMGraphVizLink[] = []
  const nodeSet = new Set<string>()

  function addNode(node: LLMGraphVizNode) {
    if (!nodeSet.has(node.id)) {
      nodeSet.add(node.id)
      nodes.push(node)
    } else {
      // Increment value for repeated occurrences (e.g. same strategy in many docs)
      const existing = nodes.find((n) => n.id === node.id)
      if (existing) existing.value = Math.min((existing.value || 1) + 1, 20)
    }
  }

  function addLink(source: string, target: string, relation: string) {
    // Avoid duplicate edges
    const key = `${source}→${target}:${relation}`
    if (!nodeSet.has(key)) {
      nodeSet.add(key)
      links.push({ source, target, relation })
    }
  }

  for (const { relativePath, entities } of docResults) {
    const shortName = relativePath.split("/").pop() || relativePath
    const docId = `doc:${relativePath}`
    addNode({ id: docId, name: shortName, category: "document", value: 2 })

    const companyId = entities.company ? `company:${entities.company}` : null
    if (entities.company && companyId) {
      addNode({ id: companyId, name: entities.company, category: "company", value: 3 })
      addLink(docId, companyId, "管理人")
    }

    for (const product of entities.products) {
      const pid = `product:${product}`
      addNode({ id: pid, name: product, category: "product", value: 2 })
      if (companyId) addLink(companyId, pid, "旗下产品")
      else addLink(docId, pid, "产品")
    }

    for (const strategy of entities.strategies) {
      const sid = `strategy:${strategy}`
      addNode({ id: sid, name: strategy, category: "strategy", value: 2 })
      // Connect strategy to company (if available) or document
      const anchor = companyId ?? docId
      addLink(anchor, sid, "投资策略")
    }

    for (const member of entities.team) {
      const personId = `person:${member.name}`
      addNode({ id: personId, name: member.name, category: "person", value: 2, detail: member.role })
      const anchor = companyId ?? docId
      addLink(anchor, personId, member.role || "团队成员")
    }
  }

  return { nodes, links, docResults }
}

/** Invalidate LLM entity cache for a scope. */
export async function invalidateLLMEntityCache(folderPath?: string | null): Promise<void> {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  await pgDeleteLLMEntityCache(normalized || null)
}

export type EmbedJobStatus = {
  scope: string
  status: "queued" | "running" | "done" | "error"
  totalFiles: number
  processedFiles: number
  currentFile: string
  message: string
  startedAt: number
  finishedAt?: number
}

function getEmbedJobMap(): Map<string, EmbedJobStatus> {
  const g = globalThis as typeof globalThis & { __kbEmbedJobs?: Map<string, EmbedJobStatus> }
  if (!g.__kbEmbedJobs) g.__kbEmbedJobs = new Map()
  return g.__kbEmbedJobs
}

export function getEmbedJobStatus(folderPath?: string | null): EmbedJobStatus | null {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  const key = normalized || "__root__"
  return getEmbedJobMap().get(key) ?? null
}

export type DiskIndexInfo = {
  exists: boolean
  scope: string
  indexedDocuments: number
  indexedChunks: number
  updatedAt: string | null
  model: string | null
  /** relative file paths that are in the index */
  indexedFiles: string[]
}

/** Read the persisted index metadata for a scope without loading any vectors. */
export async function getDiskIndexInfo(folderPath?: string | null): Promise<DiskIndexInfo> {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  const scopeKey = normalized || ""
  const info = await pgGetIndexInfo(scopeKey)
  return { ...info, scope: normalized || "" }
}

/**
 * Start background embedding for a scope and track progress in globalThis.
 * Returns immediately; poll getEmbedJobStatus() to monitor progress.
 */
export function startEmbedJob(folderPath?: string | null) {
  const normalized = normalizeKnowledgeBasePath(folderPath)
  const key = normalized || "__root__"
  const jobs = getEmbedJobMap()
  const job: EmbedJobStatus = {
    scope: normalized || "",
    status: "queued",
    totalFiles: 0,
    processedFiles: 0,
    currentFile: "",
    message: "准备中...",
    startedAt: Date.now(),
  }
  jobs.set(key, job)
  void (async () => {
    try {
      const result = await getOrBuildVectorStore(normalized, (done, total, file) => {
        job.status = "running"
        job.totalFiles = total
        job.processedFiles = done
        job.currentFile = file
        job.message = `正在向量化 ${done}/${total}: ${file.split("/").pop() ?? file}`
      })
      job.status = "done"
      job.finishedAt = Date.now()
      job.totalFiles = result.indexedDocuments
      job.processedFiles = result.indexedDocuments
      job.message = `向量化完成，共 ${result.indexedDocuments} 个文档`
      setTimeout(() => { if (jobs.get(key) === job) jobs.delete(key) }, 30_000)
    } catch (err: any) {
      job.status = "error"
      job.message = err?.message || String(err)
      job.finishedAt = Date.now()
      setTimeout(() => { if (jobs.get(key) === job) jobs.delete(key) }, 60_000)
    }
  })()
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

type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number }

function extractTokenUsage(response: { usage_metadata?: unknown; response_metadata?: unknown }): TokenUsage {
  // LangChain may return usage in snake_case or camelCase keys depending on provider/version.
  const meta: Record<string, unknown> =
    (response.usage_metadata as Record<string, unknown>) ||
    ((response.response_metadata as Record<string, unknown>)?.token_usage as Record<string, unknown>) ||
    {}

  const inputTokens = Number(meta.input_tokens ?? meta.inputTokens ?? meta.prompt_tokens ?? meta.promptTokens ?? 0)
  const outputTokens = Number(meta.output_tokens ?? meta.outputTokens ?? meta.completion_tokens ?? meta.completionTokens ?? 0)
  const totalTokens = Number(meta.total_tokens ?? meta.totalTokens ?? 0) || (inputTokens + outputTokens)

  return { inputTokens, outputTokens, totalTokens }
}

function tokenizeForBm25(text: string) {
  const lowered = text.toLowerCase()
  const terms = lowered.match(/[\u4e00-\u9fff]|[a-z0-9_]+/g) || []
  return terms.filter((term) => term.trim().length > 0)
}

/** Build a BM25 inverted index from vector rows. Called once at index construction time. */
function buildBm25Index(rows: MemoryVectorRow[]): Bm25PreIndex {
  const N = rows.length
  if (N === 0) return { postings: {}, docTermFreqs: [], docLengths: [], avgdl: 0 }

  const docTermFreqs: Record<string, number>[] = new Array(N)
  const docLengths: number[] = new Array(N)
  const postings: Record<string, number[]> = {}
  let totalLen = 0

  for (let i = 0; i < N; i++) {
    const terms = tokenizeForBm25(String(rows[i].content || ""))
    const tf: Record<string, number> = {}
    for (const term of terms) tf[term] = (tf[term] || 0) + 1
    docTermFreqs[i] = tf
    docLengths[i] = terms.length
    totalLen += terms.length
    for (const term of Object.keys(tf)) {
      if (!postings[term]) postings[term] = []
      postings[term].push(i)
    }
  }

  return { postings, docTermFreqs, docLengths, avgdl: totalLen / N }
}

/**
 * Rank chunks using a pre-built BM25 inverted index.
 * O(|query_terms| × avg_postings) instead of O(N × avgDocLen).
 */
function bm25RankChunks(
  query: string,
  rows: MemoryVectorRow[],
  preIndex: Bm25PreIndex,
  topK = 4,
): Document[] {
  const { postings, docTermFreqs, docLengths, avgdl } = preIndex
  const N = rows.length
  if (N === 0) return []

  const queryTerms = tokenizeForBm25(query)
  if (!queryTerms.length) return []
  const uniqueQueryTerms = Array.from(new Set(queryTerms))
  const k1 = 1.5
  const b = 0.75

  // Only consider docs that contain at least one query term (inverted index lookup)
  const candidateSet = new Set<number>()
  for (const term of uniqueQueryTerms) {
    const posting = postings[term]
    if (posting) for (const idx of posting) candidateSet.add(idx)
  }
  if (!candidateSet.size) return []

  const scored: Array<{ idx: number; score: number }> = []
  for (const idx of candidateSet) {
    if (idx >= N) continue
    const tf = docTermFreqs[idx]
    const dl = docLengths[idx]
    let score = 0
    for (const term of uniqueQueryTerms) {
      const f = tf[term] || 0
      if (!f) continue
      const df = postings[term]?.length ?? 0
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
      const denom = f + k1 * (1 - b + b * (dl / Math.max(avgdl, 1)))
      score += idf * ((f * (k1 + 1)) / Math.max(denom, 1e-9))
    }
    if (score > 0) scored.push({ idx, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK).map(({ idx }) =>
    new Document({
      pageContent: String(rows[idx].content || ""),
      metadata: rows[idx].metadata || {},
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

// ── Shared retrieval context builder ─────────────────────────────────────────

type RetrievalContext = {
  messages: Array<{ role: "system" | "user"; content: string }>
  sources: string[]
  indexedDocuments: number
  indexedChunks: number
}

/** Embed a question and run PG HNSW similarity search. Used for large scopes where vectors aren't in RAM. */
async function pgVectorSearchDocs(
  folderPath: string | null | undefined,
  question: string,
  embeddingsModel: OpenAIEmbeddings,
  topK: number,
): Promise<Document[]> {
  const scope = normalizeKnowledgeBasePath(folderPath) || ""
  try {
    const queryVec = await embeddingsModel.embedQuery(question)
    const rows = await pgVectorSearch(scope, queryVec, topK)
    return rows.map((r) => new Document({ pageContent: r.content, metadata: r.metadata }))
  } catch {
    return []
  }
}

async function buildRetrievalContext(input: {
  question: string
  folderPath?: string | null
  filePath?: string | null
  useBm25?: boolean
  useGraphRag?: boolean
}): Promise<RetrievalContext> {
  const question = input.question.trim()
  const enableBm25 = input.useBm25 !== false
  const enableGraphRag = input.useGraphRag === true

  // ── Single-file mode ──
  if (input.filePath) {
    const file = await getKnowledgeBaseFile(input.filePath)
    const text = await readFileDocumentText(file.absolutePath, file.extension)
    const scopeLabel = file.relativePath
    return {
      messages: [
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
      ],
      sources: [file.relativePath],
      indexedDocuments: 1,
      indexedChunks: 1,
    }
  }

  // ── Folder mode ──
  const folderPath = normalizeKnowledgeBasePath(input.folderPath)
  let index: KnowledgeBaseIndexCacheEntry | null = null
  const matches: Document[] = []

  try {
    index = await getOrBuildVectorStore(folderPath)
    const rows = (((index.vectorStore as any).memoryVectors || []) as MemoryVectorRow[])
    const denseMatches = rows.length > 0
      ? await index.vectorStore.similaritySearch(question, 4)
      : await pgVectorSearchDocs(folderPath, question, createIndexEmbeddingsModel(), 4)
    const bm25Matches = enableBm25 ? bm25RankChunks(question, rows, index.bm25Index, 4) : []
    const seedDocs = [...denseMatches, ...bm25Matches]

    // Collect seed chunk indices (positions in the rows array) for graph expansion
    const seedIndices: number[] = []
    if (enableGraphRag) {
      for (const doc of seedDocs) {
        const idx = rows.findIndex(
          (r) => String(r.content || "") === doc.pageContent && String(r.metadata?.source || "") === String(doc.metadata?.source || ""),
        )
        if (idx !== -1) seedIndices.push(idx)
      }
    }

    const merged = [...seedDocs]
    // Graph RAG expansion: 1-hop traversal via shared entities
    if (enableGraphRag && seedIndices.length > 0) {
      const graphExpanded = graphExpandContext(question, rows, seedIndices, index.graphIndex, 4)
      merged.push(...graphExpanded)
    }

    const seen = new Set<string>()
    for (const m of merged) {
      const source = String(m.metadata?.source || "")
      const key = `${source}|${m.pageContent.slice(0, 120)}`
      if (seen.has(key)) continue
      seen.add(key)
      matches.push(m)
      if (matches.length >= 8) break
    }
  } catch (error: any) {
    const msg = String(error?.message || error)
    if (!msg.includes("没有可用于问答的文档")) throw classifyApiError(error)
  }

  const hasGraphExpanded = matches.some((m) => m.metadata?.graphExpanded)
  const context = matches
    .map((m, i) => {
      const tag = m.metadata?.graphExpanded ? "[图谱扩展]" : ""
      return `资料 ${i + 1}${tag} (${String(m.metadata?.source || "未知来源")})\n${m.pageContent}`
    })
    .join("\n\n")

  const sources = Array.from(
    new Set(matches.map((m) => String(m.metadata?.source || "")).filter(Boolean)),
  )

  const systemNote = enableGraphRag && hasGraphExpanded
    ? "你是市场研究知识库助手。只允许基于提供的资料回答问题。部分资料来自知识图谱关联扩展（标注[图谱扩展]），请综合利用。如果资料里没有足够依据，直接明确说明不知道或资料不足，不要编造。回答使用中文，并在结尾列出引用到的文件路径。"
    : "你是市场研究知识库助手。只允许基于提供的资料回答问题。如果资料里没有足够依据，直接明确说明不知道或资料不足，不要编造。回答使用中文，并在结尾列出引用到的文件路径。"

  return {
    messages: [
      {
        role: "system",
        content:
          matches.length > 0
            ? systemNote
            : "你是市场研究助手。当前本地知识库为空，因此本轮回答不引用本地资料。你可以直接回答用户的问题，但需要明确说明当前没有本地文档可供检索。回答使用中文。",
      },
      {
        role: "user",
        content:
          matches.length > 0
            ? `当前检索范围：${folderPath || "全部资料"}\n\n问题：${question}\n\n参考资料：\n${context}`
            : `当前检索范围：${folderPath || "全部资料"}\n\n问题：${question}\n\n当前知识库目录为空，请直接基于通用能力回答，并提醒用户尚未上传资料。`,
      },
    ],
    sources,
    indexedDocuments: index?.indexedDocuments ?? 0,
    indexedChunks: index?.indexedChunks ?? 0,
  }
}

export async function askKnowledgeBaseQuestion(input: {
  question: string
  folderPath?: string | null
  filePath?: string | null
  useBm25?: boolean
  useGraphRag?: boolean
  modelMode?: KbModelMode
}) {
  const question = input.question.trim()
  if (!question) throw new Error("请输入问题")
  const ctx = await buildRetrievalContext(input)
  const modelId = selectModelForQuestion(input.modelMode ?? "auto")
  const model = createChatModel(modelId)
  const response = await model.invoke(ctx.messages)
  return {
    answer: stringifyModelContent(response.content),
    sources: ctx.sources,
    indexedDocuments: ctx.indexedDocuments,
    indexedChunks: ctx.indexedChunks,
    tokenUsage: extractTokenUsage(response),
    model: modelId,
  }
}

/**
 * Streams the LLM response token-by-token, yielding text deltas then a final
 * done event with sources and metadata. Retrieval happens before the first
 * yield, so time-to-first-token ≈ embedding API latency (~1s) rather than
 * full generation time (~30s).
 */
export async function* streamKnowledgeBaseAnswer(input: {
  question: string
  folderPath?: string | null
  filePath?: string | null
  useBm25?: boolean
  useGraphRag?: boolean
  modelMode?: KbModelMode
}): AsyncGenerator<
  | { type: "text"; delta: string; modelId?: string }
  | { type: "done"; sources: string[]; indexedDocuments: number; indexedChunks: number; model: string; tokenUsage?: TokenUsage }
> {
  const question = input.question.trim()
  if (!question) {
    yield { type: "done", sources: [], indexedDocuments: 0, indexedChunks: 0, model: MODEL_IDS.plus }
    return
  }
  const ctx = await buildRetrievalContext(input)
  const modelId = selectModelForQuestion(input.modelMode ?? "auto")
  const model = createChatModel(modelId)
  let capturedUsage: TokenUsage | undefined

  const stream = await model.stream(ctx.messages)
  for await (const chunk of stream) {
    const usage = extractTokenUsage(chunk as { usage_metadata?: unknown; response_metadata?: unknown })
    if ((usage.totalTokens ?? 0) > 0) {
      capturedUsage = usage
    }
    const delta = stringifyModelContent(chunk.content)
    if (delta) yield { type: "text", delta, modelId }
  }

  yield {
    type: "done",
    sources: ctx.sources,
    indexedDocuments: ctx.indexedDocuments,
    indexedChunks: ctx.indexedChunks,
    model: modelId,
    tokenUsage: capturedUsage,
  }
}