/**
 * On-device STT post-process (FunASR/Vosk): collapse CJK spaces + fuzzy-fix known entities
 * before AiVoiceOverlay routing / knowledge / researcher / product search.
 */
export type VoiceEntityKind = "person" | "manager" | "product"

export type VoiceEntityCandidate = {
  kind: VoiceEntityKind
  name: string
  score: number
}

export type PreparedVoiceQuery = {
  /** Original raw transcript (trimmed). */
  raw: string
  /** Space-normalized text. */
  normalized: string
  /** Entity-corrected text used for intent + search. */
  text: string
  replacements: Array<{ from: string; to: string }>
  /** Near-miss candidates when correction is ambiguous. */
  candidates: VoiceEntityCandidate[]
  ambiguous: boolean
}

const CJK = /[\u4e00-\u9fff]/

/** Well-known people that appear in knowledge-base Q&A. */
export const KNOWN_PERSONS: string[] = [
  "左广东",
]

/** Well-known private-fund managers / brands (short + full). */
export const KNOWN_MANAGERS: string[] = [
  "宁波幻方",
  "幻方量化",
  "幻方",
  "九坤投资",
  "九坤",
  "明汯投资",
  "明汯",
  "衍复投资",
  "衍复",
  "灵均投资",
  "灵均",
  "诚奇资产",
  "诚奇",
  "因诺资产",
  "因诺",
  "量派投资",
  "量派",
  "启林投资",
  "启林",
  "天演资本",
  "天演",
  "永康投资",
  "宽德",
  "赫富",
  "黑翼资产",
  "黑翼",
  "世纪前沿",
  "佳期投资",
  "佳期",
  "磐松",
  "金戈量锐",
  "思勰投资",
  "思勰",
  "鸣石投资",
  "鸣石",
  "致诚卓远",
  "进化论",
  "高毅",
  "景林",
  "淡水泉",
  "希瓦",
  "睿远",
  "正心谷",
]

/** Frequently asked products (voice product-page routing). */
export const KNOWN_PRODUCTS: string[] = [
  "荣熙恒盈2号",
  "荣熙恒盈二号",
  "荣熙恒盈1号",
  "荣熙恒盈一号",
  "荣熙恒盈",
  "恒盈2号",
  "恒盈二号",
  "荣熙共赢同策略",
  "荣熙共赢",
  "金舆稳健增长",
]

/**
 * Direct STT near-miss aliases observed on-device (Vosk small-cn).
 * Longer keys first.
 */
const STT_ALIASES: Array<[string, string]> = [
  ["宁波换房", "宁波幻方"],
  ["宁波换方", "宁波幻方"],
  ["宁波幻房", "宁波幻方"],
  ["着广东", "左广东"],
  ["做广东", "左广东"],
  ["坐广东", "左广东"],
  ["卓广东", "左广东"],
  ["左广电", "左广东"],
  ["左广洞", "左广东"],
  ["九困投资", "九坤投资"],
  ["酒坤投资", "九坤投资"],
  ["久坤投资", "九坤投资"],
  ["九困", "九坤"],
  ["酒坤", "九坤"],
  ["久坤", "九坤"],
  ["换房", "幻方"],
  ["换方", "幻方"],
  ["幻房", "幻方"],
  ["桓方", "幻方"],
  ["恒盈二号", "恒盈2号"],
  ["容许衡阳二号", "荣熙恒盈2号"],
  ["容许衡阳2号", "荣熙恒盈2号"],
  ["容许衡阳一号", "荣熙恒盈1号"],
  ["容许衡阳1号", "荣熙恒盈1号"],
  ["容许衡阳", "荣熙恒盈"],
  ["荣许恒盈", "荣熙恒盈"],
  ["荣喜恒盈", "荣熙恒盈"],
  ["荣西恒盈", "荣熙恒盈"],
  ["绒熙恒盈", "荣熙恒盈"],
  ["衡阳二号", "恒盈2号"],
  ["衡阳2号", "恒盈2号"],
  ["恒阳二号", "恒盈2号"],
  ["恒阳2号", "恒盈2号"],
  ["蓉西共赢同策略", "荣熙共赢同策略"],
  ["容西共赢同策略", "荣熙共赢同策略"],
  ["荣西共赢同策略", "荣熙共赢同策略"],
  ["荣希共赢同策略", "荣熙共赢同策略"],
  ["绒熙共赢同策略", "荣熙共赢同策略"],
  ["荣喜共赢同策略", "荣熙共赢同策略"],
  ["蓉西共赢", "荣熙共赢"],
  ["容西共赢", "荣熙共赢"],
  ["荣西共赢", "荣熙共赢"],
  ["荣希共赢", "荣熙共赢"],
  ["绒熙共赢", "荣熙共赢"],
  ["荣喜共赢", "荣熙共赢"],
  ["蓉西", "荣熙"],
  ["容西", "荣熙"],
  ["荣西", "荣熙"],
  ["荣希", "荣熙"],
  ["绒熙", "荣熙"],
  ["荣喜", "荣熙"],
  ["蓉西恒盈", "荣熙恒盈"],
  ["容西恒盈", "荣熙恒盈"],
  ["荣希恒盈", "荣熙恒盈"],
]

function isCjk(ch: string): boolean {
  return CJK.test(ch)
}

/** Collapse whitespace between CJK chars; light trailing punctuation cleanup. */
export function normalizeVoiceTranscript(raw: string): string {
  let s = String(raw || "").replace(/\u00a0/g, " ").trim()
  if (!s) return ""
  // Repeatedly glue CJK-space-CJK (Vosk often emits "着 广东 看多").
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
    if (next === s) break
    s = next
  }
  s = s.replace(/([\u4e00-\u9fff])\s+([A-Za-z0-9])/g, "$1$2")
  s = s.replace(/([A-Za-z0-9])\s+([\u4e00-\u9fff])/g, "$1$2")
  s = s.replace(/\s+/g, " ").trim()
  // Keep a single trailing question mark if present; drop trailing commas/periods.
  if (/[?？]$/.test(s)) {
    s = s.replace(/[，,。.!！\s]+([?？])$/, "$1")
  } else {
    s = s.replace(/[，,。.!！]+$/g, "")
  }
  return s.trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const rows = a.length + 1
  const cols = b.length + 1
  const prev = new Array<number>(cols)
  const cur = new Array<number>(cols)
  for (let j = 0; j < cols; j += 1) prev[j] = j
  for (let i = 1; i < rows; i += 1) {
    cur[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j < cols; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j < cols; j += 1) prev[j] = cur[j]
  }
  return prev[b.length]
}

function maxEditDistance(len: number): number {
  if (len <= 2) return 0
  if (len === 3) return 1
  if (len <= 5) return 1
  return 2
}

type VocabItem = { kind: VoiceEntityKind; name: string }

function allVocab(): VocabItem[] {
  const out: VocabItem[] = []
  for (const name of KNOWN_PERSONS) out.push({ kind: "person", name })
  for (const name of KNOWN_MANAGERS) out.push({ kind: "manager", name })
  for (const name of KNOWN_PRODUCTS) out.push({ kind: "product", name })
  // Longer names first for greedy window replace.
  out.sort((a, b) => b.name.length - a.name.length)
  return out
}

function applyAliases(text: string): { text: string; replacements: Array<{ from: string; to: string }> } {
  let s = text
  const replacements: Array<{ from: string; to: string }> = []
  const aliases = [...STT_ALIASES].sort((a, b) => b[0].length - a[0].length)
  for (const [from, to] of aliases) {
    if (!from || from === to) continue
    if (s.includes(from)) {
      s = s.split(from).join(to)
      replacements.push({ from, to })
    }
  }
  return { text: s, replacements }
}

/**
 * Slide windows over `text` and replace near-miss spans with canonical entity names.
 * Skips spans that already exactly match a vocab entry.
 */
function fuzzyReplaceEntities(text: string): {
  text: string
  replacements: Array<{ from: string; to: string }>
  candidates: VoiceEntityCandidate[]
} {
  const vocab = allVocab()
  const exactPresent = new Set(vocab.filter((v) => text.includes(v.name)).map((v) => v.name))
  const replacements: Array<{ from: string; to: string }> = []
  const candidates: VoiceEntityCandidate[] = []
  let s = text

  for (const item of vocab) {
    if (exactPresent.has(item.name) || s.includes(item.name)) continue
    const L = item.name.length
    if (L < 2) continue
    const maxDist = maxEditDistance(L)
    let best: { start: number; end: number; dist: number } | null = null
    for (let win = Math.max(2, L - 1); win <= L + 1; win += 1) {
      if (win > s.length) continue
      for (let i = 0; i + win <= s.length; i += 1) {
        const span = s.slice(i, i + win)
        // Prefer windows that are mostly CJK (avoid matching English noise).
        const cjkCount = [...span].filter(isCjk).length
        if (cjkCount < Math.min(2, win)) continue
        const dist = levenshtein(span, item.name)
        if (dist > maxDist) continue
        if (dist === 0) continue
        if (!best || dist < best.dist || (dist === best.dist && win === L)) {
          best = { start: i, end: i + win, dist }
        }
      }
    }
    if (!best) continue
    const from = s.slice(best.start, best.end)
    const score = 1 - best.dist / Math.max(L, from.length)
    candidates.push({ kind: item.kind, name: item.name, score })
    // Auto-replace only strong matches (1 edit on short names, or score >= 0.66).
    if (best.dist <= 1 || score >= 0.66) {
      s = s.slice(0, best.start) + item.name + s.slice(best.end)
      replacements.push({ from, to: item.name })
      exactPresent.add(item.name)
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return { text: s, replacements, candidates }
}

/**
 * Score a free-form name against known managers (for researcher path).
 * Returns ranked candidates; caller may auto-pick or ask user.
 */
export function fuzzyMatchManagers(
  query: string,
  extraNames: string[] = [],
): VoiceEntityCandidate[] {
  const q = normalizeVoiceTranscript(query)
  if (!q) return []
  const names = Array.from(new Set([...KNOWN_MANAGERS, ...extraNames].filter((n) => n && n.length >= 2)))
  const out: VoiceEntityCandidate[] = []
  for (const name of names) {
    if (q === name || q.includes(name) || name.includes(q)) {
      out.push({ kind: "manager", name, score: q === name ? 1 : 0.92 })
      continue
    }
    const dist = levenshtein(q, name)
    const maxDist = maxEditDistance(Math.max(q.length, name.length))
    if (dist <= maxDist) {
      out.push({
        kind: "manager",
        name,
        score: 1 - dist / Math.max(q.length, name.length),
      })
    }
  }
  out.sort((a, b) => b.score - a.score || b.name.length - a.name.length)
  // Dedupe by name keeping best score.
  const seen = new Set<string>()
  return out.filter((c) => {
    if (seen.has(c.name)) return false
    seen.add(c.name)
    return true
  })
}

/**
 * Full pipeline: normalize spaces then alias + fuzzy entity correction.
 */
export function prepareVoiceQuery(raw: string): PreparedVoiceQuery {
  const trimmed = String(raw || "").trim()
  const normalized = normalizeVoiceTranscript(trimmed)
  if (!normalized) {
    return {
      raw: trimmed,
      normalized: "",
      text: "",
      replacements: [],
      candidates: [],
      ambiguous: false,
    }
  }

  const aliased = applyAliases(normalized)
  const fuzzy = fuzzyReplaceEntities(aliased.text)
  const replacements = [...aliased.replacements, ...fuzzy.replacements]
  const text = fuzzy.text

  // Ambiguous when multiple strong manager candidates and none was auto-applied
  // as an exact substring of the corrected text.
  const managerHits = fuzzyMatchManagers(text).filter((c) => c.score >= 0.75)
  const top = managerHits[0]
  const second = managerHits[1]
  const ambiguous =
    Boolean(top && second && top.score - second.score < 0.08 && top.score < 0.98 && !text.includes(top.name))

  const candidates = ambiguous
    ? managerHits.slice(0, 4)
    : fuzzy.candidates.filter((c) => c.score >= 0.7).slice(0, 4)

  return {
    raw: trimmed,
    normalized,
    text,
    replacements,
    candidates,
    ambiguous,
  }
}
