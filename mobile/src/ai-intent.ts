import { prepareVoiceQuery } from "@/voice-normalize"
export type AiIntent =
  | { kind: "team-background"; keyword: string }
  | { kind: "manager-profile"; managerName: string }
  | { kind: "fund-performance"; query: string }
  | {
      kind: "fund-report"
      reportKind: "weekly" | "monthly" | "quarterly"
      productQuery: string
      /** When set, use these dates; otherwise compute 「最新」 completed period. */
      begin?: string
      end?: string
      latest: boolean
    }
  | { kind: "knowledge"; question: string }
  | { kind: "navigate"; path: string; label: string }
  | { kind: "assistant" }

const NAV_HINTS: Array<{ re: RegExp; path: string; label: string }> = [
  { re: /AI?\u77e5\u8bc6\u5e93|\u6253\u5f00\u77e5\u8bc6\u5e93|\u77e5\u8bc6\u5e93/, path: "/knowledge", label: "AI\u77e5\u8bc6\u5e93" },
  { re: /AI?\u7814\u7a76\u5458|\u6253\u5f00\u7814\u7a76\u5458|\u7814\u7a76\u6280\u80fd/, path: "/researcher", label: "AI\u7814\u7a76\u5458" },
  { re: /\u79c1\u52df\u57fa\u91d1|\u6253\u5f00\u79c1\u52df/, path: "/private-funds", label: "\u79c1\u52df\u57fa\u91d1" },
  { re: /\u8ddf\u8e2a\u4ea7\u54c1|\u6253\u5f00\u8ddf\u8e2a|\u57fa\u91d1\u8ddf\u8e2a/, path: "/fund-tracking", label: "\u8ddf\u8e2a\u4ea7\u54c1" },
  { re: /\bMOM\b|MOM\u5206\u6790|\u6253\u5f00MOM/, path: "/mom", label: "MOM\u5206\u6790" },
  { re: /\u5b9e\u65f6\u884c\u60c5|\u6253\u5f00\u884c\u60c5|\u80a1\u6307\u884c\u60c5/, path: "/quotes", label: "\u5b9e\u65f6\u884c\u60c5" },
  { re: /\u5168\u5929\u5019/, path: "/all-weather", label: "\u5168\u5929\u5019\u8ddf\u8e2a" },
  { re: /\u641c\u7d22\u57fa\u91d1|\u53bb\u641c\u7d22/, path: "/(tabs)/search", label: "\u641c\u7d22" },
  { re: /\u6253\u5f00\u62a5\u544a|\u62a5\u544a\u751f\u6210|\u57fa\u91d1\u62a5\u544a/, path: "/fund-reports", label: "\u62a5\u544a" },
]

const TEAM_BG_HINT = /\u56e2\u961f\u80cc\u666f|\u80cc\u666f\u7684\u7ba1\u7406\u4eba|\u6709.{1,12}\u80cc\u666f|\u56e2\u961f(?:\u91cc|\u4e2d|\u5185)\u6709|\u54ea\u4e9b.*\u80cc\u666f|\u80cc\u666f.*\u7ba1\u7406\u4eba|\u51fa\u8eab|\u524d\u4efb.*\u80cc\u666f/

const WELL_KNOWN_FIRMS = [
  "\u745e\u94f6", "\u9ad8\u76db", "\u4e2d\u91d1", "\u6d77\u5bcc", "\u6469\u6839", "\u7f8e\u6797", "\u745e\u4fe1",
  "\u82b1\u65d7", "\u6c47\u4e30", "\u91ce\u6751", "\u5df4\u514b\u83b1", "\u5fb7\u94f6", "\u6cd5\u5df4",
  "\u534e\u6cf0", "\u4e2d\u4fe1", "\u56fd\u541b", "\u7533\u4e07", "\u62db\u5546", "\u5e7f\u53d1",
  "\u4e2d\u4fe1\u8bc1\u5238", "\u4e2d\u91d1\u516c\u53f8", "UBS", "Goldman", "JPMorgan", "Citadel",
]

function extractTeamBackgroundKeyword(text: string): string | null {
  const cleaned = text.trim()
  const patterns = [
    /\u6709([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)\u80cc\u666f/,
    /([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)\u80cc\u666f\u7684(?:\u7ba1\u7406\u4eba|\u56e2\u961f|\u4eba\u5458|\u540c\u4e8b|\u6210\u5458)/,
    /\u56e2\u961f(?:\u91cc|\u4e2d|\u5185)?\u6709([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)(?:\u80cc\u666f|\u51fa\u8eab)?/,
    /(?:\u6765\u81ea|\u51fa\u8eab\u4e8e?|\u5f85\u8fc7|\u505a\u8fc7)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)(?:\u7684)?(?:\u80cc\u666f)?/,
    /(?:\u7b5b\u9009|\u67e5\u627e|\u627e)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)\u80cc\u666f/,
  ]
  for (const re of patterns) {
    const m = cleaned.match(re)
    if (m?.[1]) {
      const kw = m[1].trim().replace(/^(?:\u54ea\u4e9b|\u4ec0\u4e48|\u600e\u4e48)/, "")
      if (kw.length >= 2 && !/^(?:\u7ba1\u7406\u4eba|\u56e2\u961f|\u4eba|\u54ea\u4e9b|\u6709\u54ea\u4e9b)$/.test(kw)) {
        return kw
      }
    }
  }
  for (const firm of WELL_KNOWN_FIRMS) {
    if (cleaned.includes(firm) && TEAM_BG_HINT.test(cleaned)) return firm
  }
  return null
}

const MANAGER_KW = /\u8c03\u7814|\u753b\u50cf|\u7ba1\u7406\u4eba|\u8fd9\u5bb6\u7ba1\u7406\u4eba/
const FUND_PERF_KW = /\u6536\u76ca|\u51c0\u503c|\u8d70\u52bf|\u56de\u64a4|\u8868\u73b0|\u6da8\u4e86|\u8dcc\u4e86|\u6700\u8fd1\u600e\u4e48\u6837|\u6700\u65b0\u600e\u4e48\u6837|\u6700\u65b0\u8868\u73b0|\u4e1a\u7ee9/
const KNOWLEDGE_KW = /\u77e5\u8bc6\u5e93|\u770b\u591a|\u770b\u7a7a|\u8def\u6f14|\u5c3d\u8c03|\u7eaa\u8981|\u6750\u6599\u91cc|\u8d44\u6599\u91cc|\u6587\u6863|\u7b14\u8bb0/

function extractManagerName(text: string): string | null {
  const cleaned = text.trim()
  const patterns = [
    /(?:\u8c03\u7814\u4e00\u4e0b|\u8c03\u7814\u4e0b|\u8c03\u7814)\s*([\u4e00-\u9fa5A-Za-z0-9\uff08\uff09()]{2,24}?)(?:\u8fd9\u5bb6|\u7684\u7ba1\u7406\u4eba|\u7ba1\u7406\u4eba|\u600e\u4e48\u6837|\u5982\u4f55|\u597d\u4e0d\u597d|[?\uff1f]|$)/,
    /(?:\u7ed9\u6211\u4e2a|\u7ed9\u6211\u4e00\u4efd|\u751f\u6210|\u505a\u4e00\u4efd)?\s*([\u4e00-\u9fa5A-Za-z0-9\uff08\uff09()]{2,24}?)(?:\u7684)?(?:\u7ba1\u7406\u4eba\u753b\u50cf|\u753b\u50cf\u62a5\u544a|\u753b\u50cf)/,
    /([\u4e00-\u9fa5A-Za-z0-9\uff08\uff09()]{2,24}?)\u8fd9\u5bb6\u7ba1\u7406\u4eba/,
    /\u7ba1\u7406\u4eba\s*([\u4e00-\u9fa5A-Za-z0-9\uff08\uff09()]{2,24})/,
  ]
  for (const re of patterns) {
    const m = cleaned.match(re)
    if (m?.[1]) {
      const kept = m[1].trim().replace(/^(\u4e00\u4e0b|\u4e0b|\u4e2a|\u4e00\u4efd)/, "")
      if (kept.length >= 2) return kept
    }
  }
  if (MANAGER_KW.test(cleaned)) {
    const loose = cleaned
      .replace(/\u5e2e\u6211|\u8bf7|\u7ed9\u6211|\u4e00\u4e0b|\u7684|\u4e2a|\u4e00\u4efd|\u62a5\u544a|\u8c03\u7814|\u753b\u50cf|\u7ba1\u7406\u4eba|\u8fd9\u5bb6|\u600e\u4e48\u6837|\u5982\u4f55|\u597d\u4e0d\u597d|\u770b\u770b|\u770b\u4e00\u4e0b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    if (loose.length >= 2 && loose.length <= 24) return loose
  }
  return null
}

/** Strip trailing time/perf filler left on a product-name capture. */
function scrubFundQuery(raw: string): string {
  let q = raw.trim()
  q = q.replace(/^(\u4e00\u4e0b|\u4e0b|\u8fd9\u4e2a|\u90a3\u4e2a)/, "")
  // Peel trailing filler repeatedly (最新/最近/表现/怎么样 …)
  for (let i = 0; i < 4; i += 1) {
    const next = q
      .replace(/(?:\u6700\u65b0|\u6700\u8fd1|\u8fd1\u671f|\u7684|\u6536\u76ca|\u51c0\u503c|\u8d70\u52bf|\u56de\u64a4|\u8868\u73b0|\u4e1a\u7ee9|\u600e\u4e48\u6837|\u5982\u4f55|\u597d\u4e0d\u597d)+$/g, "")
      .trim()
    if (next === q) break
    q = next
  }
  return q.trim()
}

function extractFundQuery(text: string): string | null {
  const cleaned = text.trim()
  const patterns = [
    // Allow 最新|最近|近期 before 收益/表现/… (旧版漏了「最新」, 会把「荣熙共赢最新」当成产品名)
    /([\u4e00-\u9fa5A-Za-z0-9]{2,30}?)(?:\u6700\u65b0|\u6700\u8fd1|\u8fd1\u671f)?(?:\u7684)?(?:\u6536\u76ca|\u51c0\u503c|\u8d70\u52bf|\u56de\u64a4|\u8868\u73b0|\u4e1a\u7ee9)(?:\u600e\u4e48\u6837|\u5982\u4f55|\u597d\u4e0d\u597d)?/,
    /(?:\u770b\u770b|\u6253\u5f00|\u67e5\u4e00\u4e0b|\u67e5\u4e0b)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,30}?)(?:\u7684)?(?:\u51c0\u503c|\u6536\u76ca|\u8d70\u52bf|\u56fe\u8868|\u4ea7\u54c1)?$/,
    /([SP]\w{5,})/,
  ]
  for (const re of patterns) {
    const m = cleaned.match(re)
    if (m?.[1]) {
      const q = scrubFundQuery(m[1])
      if (q.length >= 2) return q
    }
  }
  return null
}

/** Query variants for fuzzy fund search (中文「一号」↔「1号」, drop trailing filler). */
export function fundSearchVariants(query: string): string[] {
  const base = scrubFundQuery(query)
  const out: string[] = []
  const push = (value: string) => {
    const t = scrubFundQuery(value)
    if (t.length >= 2 && !out.includes(t)) out.push(t)
  }
  push(base)
  const arabic = base
    .replace(/\u4e00\u53f7/g, "1\u53f7")
    .replace(/\u4e8c\u53f7/g, "2\u53f7")
    .replace(/\u4e09\u53f7/g, "3\u53f7")
    .replace(/\u56db\u53f7/g, "4\u53f7")
    .replace(/\u4e94\u53f7/g, "5\u53f7")
    .replace(/\u516d\u53f7/g, "6\u53f7")
    .replace(/\u4e03\u53f7/g, "7\u53f7")
    .replace(/\u516b\u53f7/g, "8\u53f7")
    .replace(/\u4e5d\u53f7/g, "9\u53f7")
    .replace(/\u5341\u53f7/g, "10\u53f7")
  push(arabic)
  // Drop ordinal suffix for broader match (金舆稳健增长一号 → 金舆稳健增长)
  push(base.replace(/(?:\u4e00\u53f7|\u4e8c\u53f7|\u4e09\u53f7|[0-9]+\u53f7|FOF)$/i, ""))
  push(arabic.replace(/(?:[0-9]+\u53f7|FOF)$/i, ""))
  // Drop spoken filler 产品/基金 so 金舆追风产品 still hits 金舆追风
  push(base.replace(/(?:\u79c1\u52df\u57fa\u91d1|\u79c1\u52df|\u57fa\u91d1|\u4ea7\u54c1)+$/g, ""))
  push(arabic.replace(/(?:\u79c1\u52df\u57fa\u91d1|\u79c1\u52df|\u57fa\u91d1|\u4ea7\u54c1)+$/g, ""))
  return out
}


const REPORT_KIND_RE = /\u5468\u62a5|\u6708\u62a5|\u5b63\u62a5|\u6708\u5ea6\u62a5\u544a|\u5b63\u5ea6\u62a5\u544a/
const REPORT_ACTION_RE = /(?:\u5e2e\u6211)?(?:\u505a|\u751f\u6210|\u51fa|\u5bfc\u51fa|\u505a\u4e00\u4efd|\u751f\u6210\u4e00\u4efd)|\u62a5\u544a/

function detectReportKind(text: string): "weekly" | "monthly" | "quarterly" | null {
  if (/\u5b63\u62a5|\u5b63\u5ea6\u62a5\u544a/.test(text)) return "quarterly"
  if (/\u6708\u62a5|\u6708\u5ea6\u62a5\u544a/.test(text)) return "monthly"
  if (/\u5468\u62a5|\u5468\u5ea6\u62a5\u544a/.test(text)) return "weekly"
  // 「报告」with generate verbs → default weekly
  if (/\u62a5\u544a/.test(text) && REPORT_ACTION_RE.test(text)) return "weekly"
  return null
}

function scrubReportProductQuery(raw: string): string {
  let q = raw.trim()
  q = q.replace(/^(?:\u5e2e\u6211)?(?:\u505a|\u751f\u6210|\u51fa|\u5bfc\u51fa)(?:\u4e00\u4efd|\u4e00\u4e2a|\u4e2a)?/, "")
  q = q.replace(/^(?:\u6700\u65b0\u7684?|\u6700\u8fd1\u7684?|\u8fd1\u671f\u7684?)/, "")
  for (let i = 0; i < 4; i += 1) {
    const next = q
      .replace(/(?:\u7684)?(?:\u6700\u65b0|\u6700\u8fd1|\u8fd1\u671f)?(?:\u7684)?(?:\u5468\u62a5|\u6708\u62a5|\u5b63\u62a5|\u62a5\u544a)$/g, "")
      // Users often say …产品周报; strip trailing 产品/基金 filler.
      .replace(/(?:\u79c1\u52df\u57fa\u91d1|\u79c1\u52df|\u57fa\u91d1|\u4ea7\u54c1)+$/g, "")
      .replace(/^(?:\u6700\u65b0\u7684?|\u6700\u8fd1\u7684?)/, "")
      .replace(/^[\s\u7684,\uff0c]+|[\s\u7684,\uff0c]+$/g, "")
      .trim()
    if (next === q) break
    q = next
  }
  q = scrubFundQuery(q)
  q = q.replace(/(?:\u79c1\u52df\u57fa\u91d1|\u79c1\u52df|\u57fa\u91d1|\u4ea7\u54c1)+$/g, "").trim()
  // Drop leftover date fragments from the product capture
  q = q.replace(/(?:20\d{2}[.\-/\u5e74]\d{1,2}[.\-/\u6708]\d{1,2}\u65e5?.*)$/g, "").trim()
  return q
}

function extractReportProductQuery(text: string): string | null {
  const cleaned = text.trim()
  const patterns = [
    /(?:\u5e2e\u6211)?(?:\u505a|\u751f\u6210|\u51fa|\u5bfc\u51fa)(?:\u4e00\u4efd|\u4e00\u4e2a|\u4e2a)?(?:\u6700\u65b0\u7684?|\u6700\u8fd1\u7684?|\u8fd1\u671f\u7684?)?([\u4e00-\u9fa5A-Za-z0-9\uff08\uff09()]{2,40}?)(?:\u7684)?(?:\u5468\u62a5|\u6708\u62a5|\u5b63\u62a5|\u62a5\u544a)/,
    /([\u4e00-\u9fa5A-Za-z0-9\uff08\uff09()]{2,40}?)(?:\u7684)?(?:\u6700\u65b0|\u6700\u8fd1|\u8fd1\u671f)(?:\u7684)?(?:\u5468\u62a5|\u6708\u62a5|\u5b63\u62a5)/,
    /([\u4e00-\u9fa5A-Za-z0-9\uff08\uff09()]{2,40}?)(?:\u7684)?(?:\u5468\u62a5|\u6708\u62a5|\u5b63\u62a5)/,
    /(?:\u5468\u62a5|\u6708\u62a5|\u5b63\u62a5|\u62a5\u544a)\s*([\u4e00-\u9fa5A-Za-z0-9\uff08\uff09()]{2,40})/,
  ]
  for (const re of patterns) {
    const m = cleaned.match(re)
    if (m?.[1]) {
      const q = scrubReportProductQuery(m[1])
      if (q.length >= 2) return q
    }
  }
  // Fallback: strip action + report words from whole sentence
  if (REPORT_KIND_RE.test(cleaned) || (/\u62a5\u544a/.test(cleaned) && REPORT_ACTION_RE.test(cleaned))) {
    const q = scrubReportProductQuery(cleaned)
    if (q.length >= 2 && q.length <= 40) return q
  }
  return null
}

function extractReportDates(text: string): { begin: string; end: string } | null {
  const rangeFull = text.match(
    /(20\d{2})[.\-/\u5e74](\d{1,2})[.\-/\u6708](\d{1,2})\u65e5?\s*(?:[~\uFF5E\-\u2014\u81f3\u5230]|\u5230)\s*(20\d{2})?[.\-/\u5e74]?(\d{1,2})[.\-/\u6708]?(\d{1,2})\u65e5?/,
  )
  if (rangeFull) {
    const y1 = rangeFull[1]
    const m1 = rangeFull[2].padStart(2, "0")
    const d1 = rangeFull[3].padStart(2, "0")
    const y2 = rangeFull[4] || y1
    const m2 = rangeFull[5].padStart(2, "0")
    const d2 = rangeFull[6].padStart(2, "0")
    const begin = `${y1}-${m1}-${d1}`
    const end = `${y2}-${m2}-${d2}`
    if (begin <= end) return { begin, end }
  }
  return null
}


/** Rank a report-product candidate against the spoken query (higher is better). */
export function scoreReportProductMatch(productName: string, query: string): number {
  const name = productName.trim()
  const q = scrubReportProductQuery(query)
  if (!name || !q) return 0
  if (name === q) return 100
  if (name.startsWith(q) || q.startsWith(name)) return 90
  if (name.includes(q)) return 80 + Math.min(9, q.length)
  if (q.includes(name) && name.length >= 2) return 70 + Math.min(9, name.length)
  let pref = 0
  const lim = Math.min(name.length, q.length)
  while (pref < lim && name[pref] === q[pref]) pref += 1
  if (pref >= 2) return 40 + pref
  return 0
}

/** STT near-miss stems for 荣熙 (also applied in voice-normalize aliases). */
const RONGXI_STT_MISHEARS = ["蓉西", "容西", "荣西", "荣希", "绒熙", "荣喜"]

/** Extra query variants for AI-ball report product resolve. */
export function reportProductSearchVariants(query: string): string[] {
  const base = scrubReportProductQuery(query)
  const out = fundSearchVariants(base)
  const push = (value: string) => {
    const t = scrubReportProductQuery(value)
    if (t.length >= 2 && !out.includes(t)) out.push(t)
  }
  push(base)
  for (const bad of RONGXI_STT_MISHEARS) {
    if (base.includes(bad)) push(base.split(bad).join("荣熙"))
  }
  if (base.includes("荣熙")) {
    // Also try shorter 荣熙共赢 when user said 荣熙共赢同策略
    push(base.replace(/同策略$/, ""))
  }
  if (base.length >= 4) {
    for (const n of [base.length - 1, base.length - 2, 4, 3]) {
      if (n >= 2 && n < base.length) push(base.slice(0, n))
    }
  }
  return out
}

/** Lightweight Chinese intent classifier for the mobile AI ball. */
export function classifyAiIntent(raw: string): AiIntent {
  const prepared = prepareVoiceQuery(raw)
  const text = prepared.text.trim() || raw.trim()
  if (!text) return { kind: "assistant" }

  // Fund report generation (周报/月报/季报) — before performance / knowledge.
  {
    const reportKind = detectReportKind(text)
    if (reportKind) {
      const productQuery = extractReportProductQuery(text)
      if (productQuery) {
        const hits = prepareVoiceQuery(productQuery)
        const corrected = hits.text.trim() || productQuery
        const dates = extractReportDates(text)
        return {
          kind: "fund-report",
          reportKind,
          productQuery: corrected,
          begin: dates?.begin,
          end: dates?.end,
          latest: !dates,
        }
      }
    }
  }

  for (const hint of NAV_HINTS) {
    if (hint.re.test(text) && /\u6253\u5f00|\u8fdb\u5165|\u53bb|\u8df3\u8f6c|\u770b\u770b/.test(text)) {
      return { kind: "navigate", path: hint.path, label: hint.label }
    }
  }
  for (const hint of NAV_HINTS) {
    if (hint.re.test(text) && text.length <= 12) {
      return { kind: "navigate", path: hint.path, label: hint.label }
    }
  }

  // Prefer team-background over manager-profile ("\u7ba1\u7406\u4eba" often co-occurs).
  if (TEAM_BG_HINT.test(text)) {
    const keyword = extractTeamBackgroundKeyword(text)
    if (keyword) return { kind: "team-background", keyword }
  }

  if (MANAGER_KW.test(text)) {
    const managerName = extractManagerName(text)
    if (managerName) {
      const hits = prepareVoiceQuery(managerName)
      const corrected = hits.text.trim() || managerName
      return { kind: "manager-profile", managerName: corrected }
    }
  }

  if (FUND_PERF_KW.test(text)) {
    const query = extractFundQuery(text)
    if (query) {
      const hits = prepareVoiceQuery(query)
      return { kind: "fund-performance", query: hits.text.trim() || query }
    }
  }

  const beian = text.match(/\b([SP][A-Z0-9]{5,})\b/i)
  if (beian) return { kind: "fund-performance", query: beian[1] }

  if (KNOWLEDGE_KW.test(text) || /[\uff1f?]/.test(text) || /\u90fd\u6709\u54ea\u4e9b|\u662f\u4ec0\u4e48|\u4e3a\u4ec0\u4e48|\u600e\u4e48\u770b/.test(text)) {
    return { kind: "knowledge", question: text }
  }

  if (/[\u4e00-\u9fa5]{4,}/.test(text) && text.length <= 80) {
    return { kind: "knowledge", question: text }
  }
  return { kind: "assistant" }
}

export function intentAck(intent: AiIntent): string {
  switch (intent.kind) {
    case "team-background":
      return `\u6b63\u5728\u7b5b\u9009\u56e2\u961f\u6709\u300c${intent.keyword}\u300d\u80cc\u666f\u7684\u7ba1\u7406\u4eba\u2026`
    case "manager-profile":
      return `\u6b63\u5728\u751f\u6210\u300c${intent.managerName}\u300d\u7ba1\u7406\u4eba\u753b\u50cf\u2026`
    case "fund-performance":
      return `\u6b63\u5728\u67e5\u627e\u300c${intent.query}\u300d\u5e76\u6253\u5f00\u51c0\u503c\u2026`
    case "fund-report": {
      const kindLabel =
        intent.reportKind === "weekly"
          ? "\u5468\u62a5"
          : intent.reportKind === "monthly"
            ? "\u6708\u62a5"
            : "\u5b63\u62a5"
      return `\u6b63\u5728\u751f\u6210\u300c${intent.productQuery}\u300d${kindLabel}\u2026`
    }
    case "knowledge":
      return "\u6b63\u5728\u68c0\u7d22\u77e5\u8bc6\u5e93\u2026"
    case "navigate":
      return `\u6b63\u5728\u6253\u5f00${intent.label}\u2026`
    default:
      return "\u6b63\u5728\u601d\u8003\u2026"
  }
}
