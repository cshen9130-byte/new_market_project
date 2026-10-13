/**
 * Ranking and citation helpers for knowledge-base ask/search.
 * Pure functions: no database or model calls, so the person-name retrieval
 * path can be tested without a live index.
 */

export const KB_SHORT_FILE_CHARS = 24_000
export const KB_CONTEXT_CHARS = 28_000
export const KB_FULL_READ_FILES = 3
export const KB_NEIGHBOR_CHARS = 8_000

export const KB_IDENTITY_RULE =
  "不要把不同文件里的人或产品推断成任职、管理或从属关系。资料没有写明的关联，直接写「资料未说明该关联」，禁止使用「假设为」或「假设是」把检索到的主体绑在一起。"

export const KB_GROUNDED_RULE =
  "每个关键事实在句末用【n】标注。正文结束后另起一行，只输出一行 JSON（可以用 ```json 代码块）：" +
  "{\"citations\":[{\"n\":1,\"quote\":\"资料中连续出现的原文\",\"path\":\"与资料标题中的路径完全一致\",\"page\":2}]}。" +
  "quote 必须能在资料原文中逐字找到，至少 8 个字。page 取资料中的 [第N页]；没有页标记时填 null。没有引用到的文件不要写入 citations。"

const COMPOUND_SURNAMES = ["欧阳", "司马", "上官", "诸葛", "皇甫", "司徒", "夏侯"]

const SURNAMES = new Set([
  ..."王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程魏苏吕丁任沈姚卢傅钟姜崔谭廖范汪陆金石戴贾韦夏邱方侯邹熊孟秦白江阎薛尹段雷黎史龙陶贺顾毛郝龚邵万钱严覃武戚莫孔向左崔".split(""),
])

const STOP = new Set([
  "我们", "你们", "他们", "她们", "这个", "那个", "这些", "那些", "什么", "怎么", "如何", "哪些", "为什么",
  "可以", "是否", "有没有", "目前", "现在", "今年", "去年", "最近", "关于", "对于", "以及", "还有", "就是",
  "不是", "没有", "一个", "一些", "品种", "看多", "看空", "看好", "看淡", "观点", "路演", "笔记", "请问",
  "介绍", "一下", "总结", "根据", "其中", "如果", "因为", "所以", "但是", "然后", "已经", "还是", "或者",
])

/** Commodity words that start with a surname and must not become person anchors. */
const NOT_PERSON = new Set([
  "黄金", "白银", "黄铜", "黄豆", "黑金", "白糖", "白油", "铜矿", "铝土",
])

const PRE_BOUNDARY = new Set("的和与及在于是把将对向让叫找给请问下".split(""))

const AFTER_NAME = /^(看多|看空|看好|看淡|怎么|如何|的|在|于|说|提|路演|观点|是|把|将|对|和|与|年|月|日)/

export type KbHitChannel = "vector" | "bm25" | "path"

export type KbHit = {
  source: string
  content: string
  score: number
  channel: KbHitChannel
}

export type RankedSource = {
  source: string
  score: number
  identity: string
  aliases: string[]
  hits: KbHit[]
}

export type KbCitation = {
  n: number
  quote: string
  path: string
  page: number | null
}

export type KbSearchHit = {
  path: string
  score: number
  page: number | null
  snippet: string
  duplicate_paths: string[]
  suggest_full_read: boolean
  coverage: "full" | "neighbors"
}

export type KnowledgePage = { num: number; text: string }

export function normalizeWs(value: string): string {
  return value.replace(/\s+/g, "")
}

export function documentIdentity(source: string): string {
  const base = source.split(/[/\\]/).pop() || source
  return base.trim().toLowerCase()
}

function surnameAt(text: string, index: number): string {
  const two = text.slice(index, index + 2)
  if (COMPOUND_SURNAMES.includes(two)) return two
  const one = text.slice(index, index + 1)
  return SURNAMES.has(one) ? one : ""
}

function acceptName(name: string): boolean {
  if (name.length < 2 || name.length > 4) return false
  if (STOP.has(name) || NOT_PERSON.has(name)) return false
  for (const word of NOT_PERSON) {
    if (name.startsWith(word)) return false
  }
  return /^[\u4e00-\u9fff]+$/.test(name)
}

function findPeopleInRun(run: string): string[] {
  const out: string[] = []
  for (let i = 0; i < run.length; i++) {
    if (i > 0 && !PRE_BOUNDARY.has(run[i - 1])) continue
    const surname = surnameAt(run, i)
    if (!surname) continue
    const maxGiven = Math.min(2, 4 - surname.length)
    for (let given = maxGiven; given >= 1; given--) {
      const name = run.slice(i, i + surname.length + given)
      if (!acceptName(name)) continue
      const after = run.slice(i + name.length)
      if (after.length === 0 || AFTER_NAME.test(after)) {
        out.push(name)
        i += name.length - 1
        break
      }
    }
  }
  return out
}

function nameBeforeIndex(run: string, cueAt: number): string | null {
  const window = run.slice(Math.max(0, cueAt - 4), cueAt)
  const candidates: string[] = []
  for (const len of [4, 3, 2]) {
    if (window.length < len) continue
    const cand = window.slice(window.length - len)
    if (acceptName(cand)) candidates.push(cand)
  }
  return candidates.find((cand) => surnameAt(cand, 0) === cand.slice(0, surnameAt(cand, 0).length) && surnameAt(cand, 0)) 
    || candidates.find((cand) => cand.length === 3)
    || null
}

/** Person-like tokens a query should match against file paths and titles. */
export function extractQueryAnchors(question: string): string[] {
  const text = question.replace(/\s+/g, "").replace(/[？?！!。，,、；;：:“”"「」『』()（）]/g, "")
  const found: string[] = []
  const push = (name: string) => {
    const cleaned = name.trim()
    if (!acceptName(cleaned)) return
    if (!surnameAt(cleaned, 0)) return
    if (!found.includes(cleaned)) found.push(cleaned)
  }

  for (const match of text.matchAll(/[「『]([\u4e00-\u9fff]{2,8})[」』]/g)) {
    push(match[1].slice(0, 4))
  }

  const cueRe = /看多|看空|看好|看淡|说过|提到/g
  for (const run of text.match(/[\u4e00-\u9fff]{2,40}/g) || []) {
    for (const name of findPeopleInRun(run)) push(name)
    for (const cue of run.matchAll(cueRe)) {
      if (cue.index == null) continue
      const name = nameBeforeIndex(run, cue.index)
      if (name) push(name)
    }
  }
  return found
}

export function stanceCues(question: string): string[] {
  const cues: string[] = []
  if (/看多|看好|多头|推荐|配置/.test(question)) cues.push("多头方向", "多头", "看多", "看好")
  if (/看空|看淡|空头/.test(question)) cues.push("空头方向", "空头", "看空", "看淡")
  if (/套利/.test(question)) cues.push("套利")
  return [...new Set(cues)]
}

/**
 * Boost a path when it contains the person named in the question.
 * Stance questions prefer 路演/笔记 over a 月报 that never names the person.
 */
export function pathMatchScore(source: string, question: string, anchors: string[]): number {
  if (!anchors.length || !source) return 0
  const file = source.split(/[/\\]/).pop() || source
  const stem = file.replace(/\.[^.]+$/, "")
  const named = anchors.some((anchor) => source.includes(anchor))
  let score = named ? 100 : 0
  const stanceQuery = /看多|看空|看好|看淡|观点|路演|品种|配置/.test(question)
  if (named && stanceQuery && /路演|笔记/.test(source)) score += 25
  if (stanceQuery && /月报|周报|季报/.test(stem) && !named) score -= 40
  return score
}

function scaledHitScore(hit: KbHit): number {
  if (hit.channel === "vector") return Math.max(0, hit.score) * 10
  if (hit.channel === "bm25") return Math.min(40, Math.max(0, hit.score))
  return Math.max(0, hit.score)
}

function preferSource(current: string, next: string, question: string, anchors: string[]): string {
  const currentScore = pathMatchScore(current, question, anchors)
  const nextScore = pathMatchScore(next, question, anchors)
  if (nextScore !== currentScore) return nextScore > currentScore ? next : current
  return next.length < current.length ? next : current
}

/** A form cell: 列：「量道」，行：「代表产品」. Other questions return null. */
export function parseTableCellQuestion(question: string): { column: string; row: string | null } | null {
  const column = question.match(/列(?:（对象）)?\s*[：:]\s*「([^」]{2,40})」/u)?.[1]?.trim()
  if (!column) return null
  const row = question.match(/行(?:（维度）)?\s*[：:]\s*「([^」]{1,40})」/u)?.[1]?.trim() || null
  return { column, row }
}

export function namesColumn(text: string, column: string): boolean {
  const name = normalizeWs(column)
  if (name.length < 2) return false
  return normalizeWs(text).includes(name)
}

/** Drop a trailing 暂无数据 once the cell already has content. */
export function stripTrailingNoData(answer: string): string {
  const lines = answer.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean)
  while (lines.length > 1 && /^暂无数据[。.]?$/u.test(lines[lines.length - 1].replace(/\s+/g, ""))) {
    lines.pop()
  }
  let text = lines.join("\n").replace(/[。；;]\s*暂无数据[。.]?\s*$/u, "").trim()
  text = text.replace(/(?:^|\s)暂无数据[。.]?\s*$/u, "").trim()
  if (!text || /^暂无数据[。.]?$/u.test(text.replace(/\s+/g, ""))) return "暂无数据"
  return text
}

export function tableCellInstruction(column: string, row: string | null): string {
  const rowText = row ? `行是「${row}」。` : ""
  return `这一格的列名是「${column}」。${rowText}只使用出现了「${column}」的资料；文件名含「${column}」的短文可以整篇使用。没有出现「${column}」时只回答「暂无数据」，不要用其他产品的业绩或人名来填。代表产品只写产品名称。基金经理只填负责投资的人，不要填运营、技术或市场负责人。每条引用的 quote 必须包含「${column}」。正文已经有内容时，不要在末尾再写「暂无数据」。`
}

export function quoteNamingColumn(text: string, column: string): string | null {
  const at = text.indexOf(column)
  if (at < 0) return null
  const start = Math.max(0, at - 24)
  const end = Math.min(text.length, at + column.length + 48)
  const quote = text.slice(start, end).replace(/\s+/g, " ").trim()
  if (normalizeWs(quote).length < 8 || !namesColumn(quote, column)) return null
  return quote
}

export function cellSourcesFromCitations(
  citations: KbCitation[],
  column: string,
): Array<{ path: string; quote: string }> {
  const out: Array<{ path: string; quote: string }> = []
  const seen = new Set<string>()
  for (const citation of citations) {
    if (!namesColumn(citation.quote, column)) continue
    const key = `${citation.path}\n${normalizeWs(citation.quote)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path: citation.path, quote: citation.quote })
  }
  return out
}

/** Collapse duplicate copies of the same filename and rank path matches first. */
export function rankSources(hits: KbHit[], question: string, extraPaths: string[] = []): RankedSource[] {
  const column = parseTableCellQuestion(question)?.column
  const anchors = [...extractQueryAnchors(question), ...(column ? [column] : [])]
  const byId = new Map<string, { source: string; bestHit: number; hits: KbHit[]; aliases: string[] }>()

  const consider = (source: string, hit: KbHit | null) => {
    const trimmed = source.trim()
    if (!trimmed) return
    const id = documentIdentity(trimmed)
    let acc = byId.get(id)
    if (!acc) {
      acc = { source: trimmed, bestHit: 0, hits: [], aliases: [] }
      byId.set(id, acc)
    } else if (trimmed !== acc.source) {
      const keep = preferSource(acc.source, trimmed, question, anchors)
      if (keep !== acc.source) {
        if (!acc.aliases.includes(acc.source)) acc.aliases.push(acc.source)
        acc.source = keep
      } else if (!acc.aliases.includes(trimmed)) {
        acc.aliases.push(trimmed)
      }
    }
    if (hit) {
      acc.hits.push(hit)
      acc.bestHit = Math.max(acc.bestHit, scaledHitScore(hit))
    }
  }

  for (const hit of hits) consider(hit.source, hit)
  for (const path of extraPaths) consider(path, null)

  const ranked: RankedSource[] = []
  for (const acc of byId.values()) {
    ranked.push({
      source: acc.source,
      score: Math.round((acc.bestHit + pathMatchScore(acc.source, question, anchors)) * 1000) / 1000,
      identity: documentIdentity(acc.source),
      aliases: acc.aliases,
      hits: acc.hits,
    })
  }
  ranked.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source, "zh"))
  if (column) {
    return ranked.filter((row) =>
      namesColumn(row.source, column) || row.hits.some((hit) => namesColumn(hit.content, column)),
    )
  }
  const named = ranked.filter((row) => pathMatchScore(row.source, question, anchors) > 0)
  if (named.length === 0) return ranked
  // A named-person path hit should not drag in an unrelated 月报 that only shared a vector neighbor.
  return ranked.filter((row) => pathMatchScore(row.source, question, anchors) > 0 || row.score >= 20)
}

/** Whole file when it is short enough to answer from; otherwise a window around the stance. */
export function buildFileBody(input: {
  fullText: string
  chunks: string[]
  question: string
}): { coverage: "full" | "neighbors"; text: string } {
  const full = input.fullText.trim()
  if (full && full.length <= KB_SHORT_FILE_CHARS) {
    return { coverage: "full", text: full }
  }
  const chunks = input.chunks.map((chunk) => chunk.trim()).filter(Boolean)
  const sourceChunks = chunks.length ? chunks : full ? [full.slice(0, KB_NEIGHBOR_CHARS)] : []
  return { coverage: "neighbors", text: neighborWindow(sourceChunks, input.question, KB_NEIGHBOR_CHARS) }
}

export function neighborWindow(chunks: string[], question: string, maxChars: number): string {
  const column = parseTableCellQuestion(question)?.column
  const cues = [...stanceCues(question), ...extractQueryAnchors(question), ...(column ? [column] : [])]
  const picked = new Set<number>()
  chunks.forEach((chunk, index) => {
    if (cues.some((cue) => cue && chunk.includes(cue))) {
      for (let j = index - 1; j <= index + 1; j++) {
        if (j >= 0 && j < chunks.length) picked.add(j)
      }
    }
  })
  if (picked.size === 0) {
    for (let i = 0; i < Math.min(chunks.length, 3); i++) picked.add(i)
  }
  const parts: string[] = []
  let used = 0
  for (const index of [...picked].sort((a, b) => a - b)) {
    const piece = chunks[index].trim()
    if (!piece) continue
    if (used > 0 && used + piece.length > maxChars) break
    const slice = used === 0 && piece.length > maxChars ? piece.slice(0, maxChars) : piece
    parts.push(slice)
    used += slice.length
    if (used >= maxChars) break
  }
  return parts.join("\n\n")
}

export function assembleContext(
  parts: Array<{ source: string; text: string }>,
  maxChars = KB_CONTEXT_CHARS,
): { body: string; sources: string[] } {
  const kept: string[] = []
  const sources: string[] = []
  let used = 0
  for (const part of parts) {
    const text = part.text.trim()
    if (!text) continue
    const block = `资料 (${part.source})\n${text}`
    if (kept.length === 0 && block.length > maxChars) {
      kept.push(block.slice(0, maxChars) + "\n\n[…内容过长，已截断]")
      sources.push(part.source)
      break
    }
    if (kept.length > 0 && used + block.length > maxChars) {
      const room = maxChars - used
      if (room >= 500) {
        kept.push(block.slice(0, room) + "\n\n[…该文件后部未放入上下文]")
        sources.push(part.source)
      }
      break
    }
    kept.push(block)
    sources.push(part.source)
    used += block.length + 2
  }
  return { body: kept.join("\n\n"), sources }
}

export function locatePage(pages: KnowledgePage[], snippet: string): number | null {
  const needle = normalizeWs(snippet.replace(/\[第\d+页\]/g, "")).slice(0, 24)
  if (needle.length < 8) return null
  for (const page of pages) {
    if (normalizeWs(page.text).includes(needle)) return page.num
  }
  return null
}

export function extractSnippets(
  text: string,
  question: string,
  pages: KnowledgePage[],
  limit = 4,
): Array<{ snippet: string; page: number | null }> {
  const cues = stanceCues(question)
  const needles = [...cues, ...extractQueryAnchors(question)]
  const sources: KnowledgePage[] = pages.length ? pages : [{ num: 1, text }]
  const found: Array<{ snippet: string; page: number | null; at: number; stance: boolean }> = []
  for (const source of sources) {
    for (const needle of needles) {
      if (!needle) continue
      let from = 0
      let guard = 0
      while (guard < 2) {
        const at = source.text.indexOf(needle, from)
        if (at < 0) break
        const snippet = source.text.slice(Math.max(0, at - 40), Math.min(source.text.length, at + 160)).replace(/\s+/g, " ").trim()
        if (snippet && !found.some((item) => item.snippet === snippet)) {
          found.push({
            snippet,
            page: source.num,
            at,
            stance: cues.some((cue) => snippet.includes(cue)),
          })
        }
        from = at + needle.length
        guard++
      }
    }
  }
  found.sort((a, b) => Number(b.stance) - Number(a.stance) || a.at - b.at)
  if (found.length === 0) {
    const snippet = (sources[0]?.text || text).slice(0, 240).replace(/\s+/g, " ").trim()
    if (!snippet) return []
    return [{ snippet, page: sources[0]?.num ?? null }]
  }
  return found.slice(0, limit).map(({ snippet, page }) => ({ snippet, page }))
}

export function snippetsToHits(
  input: {
    source: string
    score: number
    aliases: string[]
    coverage: "full" | "neighbors"
    text: string
    pages: KnowledgePage[]
  },
  question: string,
  limit = 4,
): KbSearchHit[] {
  return extractSnippets(input.text, question, input.pages, limit).map((item) => ({
    path: input.source,
    score: input.score,
    page: item.page,
    snippet: item.snippet,
    duplicate_paths: input.aliases,
    suggest_full_read: input.coverage !== "full",
    coverage: input.coverage,
  }))
}

function extractCitationJson(raw: string): { answer: string; json: string | null } {
  const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?"citations"[\s\S]*?\})\s*```/)
  if (fence && fence.index != null) {
    const answer = `${raw.slice(0, fence.index)}${raw.slice(fence.index + fence[0].length)}`.trim()
    return { answer, json: fence[1] }
  }
  const inline = raw.match(/\{[\s\S]*?"citations"\s*:\s*\[[\s\S]*?\]\s*\}/)
  if (inline && inline.index != null) {
    const answer = `${raw.slice(0, inline.index)}${raw.slice(inline.index + inline[0].length)}`.trim()
    return { answer, json: inline[0] }
  }
  return { answer: raw.trim(), json: null }
}

function resolveCitationPath(raw: string, allowed: string[]): string | null {
  const path = raw.trim()
  if (!path) return null
  if (allowed.includes(path)) return path
  const hits = allowed.filter((item) => item.endsWith(path) || item.endsWith(`/${path}`) || documentIdentity(item) === documentIdentity(path))
  return hits.length === 1 ? hits[0] : null
}

/**
 * Drop invented identity links such as「假设为倍致」unless that wording is already in the source text.
 */
export function stripUnstatedIdentityAssumptions(answer: string, context: string): string {
  const ctx = normalizeWs(context).replace(/[^\u4e00-\u9fff]/g, "")
  const next = answer.replace(/[^。\n]*假设(?:为|是)[^。\n]*[。]?/g, (sentence) => {
    const compact = normalizeWs(sentence).replace(/[^\u4e00-\u9fff]/g, "")
    const at = compact.indexOf("假设")
    const clip = at >= 0 ? compact.slice(at, at + 6) : ""
    if (clip.length >= 4 && ctx.includes(clip)) return sentence
    return "资料未说明该身份关联。"
  })
  return next.replace(/(资料未说明该身份关联。){2,}/g, "资料未说明该身份关联。")
}

export function parseGroundedAnswer(
  raw: string,
  context: string,
  allowedPaths: string[],
  pageIndex: Record<string, KnowledgePage[]> = {},
): { answer: string; citations: KbCitation[]; sources: string[]; citationsGrounded: boolean } {
  const extracted = extractCitationJson(raw)
  let parsed: unknown = null
  if (extracted.json) {
    try {
      parsed = JSON.parse(extracted.json)
    } catch {
      parsed = null
    }
  }
  const ctx = normalizeWs(context)
  const rows = parsed && typeof parsed === "object" && Array.isArray((parsed as { citations?: unknown }).citations)
    ? (parsed as { citations: unknown[] }).citations
    : []
  const citations: KbCitation[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const record = row as { n?: unknown; quote?: unknown; path?: unknown; page?: unknown }
    const quote = String(record.quote || "").trim()
    if (normalizeWs(quote).length < 8) continue
    if (!ctx.includes(normalizeWs(quote))) continue
    const path = resolveCitationPath(String(record.path || ""), allowedPaths)
    if (!path) continue
    let page: number | null = null
    const pageNum = Number(record.page)
    if (Number.isFinite(pageNum) && pageNum > 0) page = pageNum
    if (page == null) page = locatePage(pageIndex[path] || [], quote)
    citations.push({
      n: Number(record.n) || citations.length + 1,
      quote,
      path,
      page,
    })
  }
  const citationsGrounded = citations.length > 0
  const sources = citationsGrounded
    ? [...new Set(citations.map((item) => item.path))]
    : allowedPaths
  return {
    answer: stripUnstatedIdentityAssumptions(extracted.answer, context),
    citations,
    sources,
    citationsGrounded,
  }
}
