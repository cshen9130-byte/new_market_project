/** Fetch a manager's public site and pull labeled 公司简介 / 投资理念 / 投资策略 blocks. */

const FETCH_TIMEOUT_MS = 8_000
const MAX_HTML_BYTES = 1_500_000
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

export type ManagerProfileBlocks = {
  company_intro: string | null
  investment_philosophy: string | null
  investment_strategy: string | null
}

const SECTION_DEFS: Array<{ key: keyof ManagerProfileBlocks; labels: string[] }> = [
  { key: "company_intro", labels: ["公司简介", "公司介绍", "管理人简介", "关于我们"] },
  { key: "investment_philosophy", labels: ["投资理念"] },
  { key: "investment_strategy", labels: ["投资策略", "策略介绍"] },
]

const MENU_NOISE = [
  "公告资讯",
  "公司公告",
  "投研观点",
  "监管动态",
  "电子签约",
  "产品中心",
  "个人中心",
  "登录/注册",
  "联系我们",
  "团队介绍",
  "公司荣誉",
  "加入我们",
  "旗下产品",
  "动态资讯",
  "公司动态",
  "私募投教",
  "合格投资者",
  "网络服务协议",
]

const STOP_MARKERS = [
  "查看更多",
  "Copyright",
  "版权所有",
  "联系电话",
  "传真电话",
  "合格投资者认定",
  "网络服务协议",
]

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1)/i

export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim().replace(/^javascript:.*/i, "")
  if (!text) return null
  const lower = text.toLowerCase()
  if (["-", "--", "无", "无网址", "暂无", "暂无网址", "n/a", "na", "null"].includes(lower)) {
    return null
  }
  if (/^https?:\/\//i.test(text)) return text
  if (text.includes(".") && !/\s/.test(text)) return text
  return null
}

export function websiteUrlCandidates(raw: string): string[] {
  const normalized = normalizeWebsiteUrl(raw)
  if (!normalized) return []
  if (/^https?:\/\//i.test(normalized)) return [normalized]
  return [`https://${normalized}`, `http://${normalized}`]
}

function isPublicHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    const host = parsed.hostname.replace(/^\[|\]$/g, "")
    if (PRIVATE_HOST.test(host)) return false
    return true
  } catch {
    return false
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

export function htmlToText(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ")
  text = text.replace(/<[^>]+>/g, " ")
  text = decodeEntities(text)
  return text.replace(/\s+/g, " ").trim()
}

function looksLikeMenu(text: string): boolean {
  const head = text.slice(0, 40)
  return MENU_NOISE.some((item) => head.startsWith(item))
}

function clipSection(raw: string): string {
  let chunk = raw.trim()
  for (const stop of STOP_MARKERS) {
    const idx = chunk.indexOf(stop)
    if (idx >= 40) chunk = chunk.slice(0, idx).trim()
  }
  return chunk.replace(/\s+/g, " ").trim()
}

export function extractLabeledBlocks(text: string): ManagerProfileBlocks {
  const out: ManagerProfileBlocks = {
    company_intro: null,
    investment_philosophy: null,
    investment_strategy: null,
  }

  for (const { key, labels } of SECTION_DEFS) {
    let best: string | null = null
    for (const label of labels) {
      let from = 0
      while (from < text.length) {
        const idx = text.indexOf(label, from)
        if (idx < 0) break
        let rest = text.slice(idx + label.length).replace(/^[\s:：]+/, "")
        const before = text.slice(Math.max(0, idx - 1), idx)
        if (/[\u4e00-\u9fffA-Za-z]/.test(before)) {
          from = idx + label.length
          continue
        }
        if (/^(是|的|了|吗|嘛|呢|吧|啊|呀)/.test(rest)) {
          from = idx + label.length
          continue
        }
        if (looksLikeMenu(rest)) {
          from = idx + label.length
          continue
        }
        const clipped = clipSection(rest.slice(0, 900))
        const minLen = key === "company_intro" ? 40 : 20
        if (clipped.length >= minLen && !looksLikeMenu(clipped)) {
          if (!best || clipped.length > best.length) best = clipped
        }
        from = idx + label.length
      }
    }
    out[key] = best
  }
  return out
}

function mergeBlocks(base: ManagerProfileBlocks, extra: ManagerProfileBlocks): ManagerProfileBlocks {
  return {
    company_intro: base.company_intro || extra.company_intro,
    investment_philosophy: base.investment_philosophy || extra.investment_philosophy,
    investment_strategy: base.investment_strategy || extra.investment_strategy,
  }
}

function collectSectionLinks(html: string, pageUrl: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const add = (href: string) => {
    try {
      const abs = new URL(href, pageUrl).toString()
      if (!isPublicHttpUrl(abs) || seen.has(abs)) return
      seen.add(abs)
      urls.push(abs)
    } catch {
      /* ignore */
    }
  }

  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html))) {
    const label = htmlToText(match[2])
    if (SECTION_DEFS.some((def) => def.labels.includes(label))) add(match[1])
  }

  const uCodeRe = /uCode="(\d+)"[^>]*>\s*([^<]{2,12})/g
  const ccMatch = html.match(/[?&]cc=(\d+)/) || pageUrl.match(/[?&]cc=(\d+)/)
  const cc = ccMatch?.[1]
  if (cc) {
    while ((match = uCodeRe.exec(html))) {
      const label = match[2].trim()
      if (!SECTION_DEFS.some((def) => def.labels.includes(label))) continue
      add(`?mt=1&mc=${match[1]}&cc=${cc}`)
    }
  }
  return urls.slice(0, 4)
}

async function fetchHtml(url: string): Promise<string | null> {
  if (!isPublicHttpUrl(url)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_HTML_BYTES) return null
    return new TextDecoder("utf-8", { fatal: false }).decode(buf)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchWebsiteProfileBlocks(websiteUrl: string): Promise<ManagerProfileBlocks> {
  const candidates = websiteUrlCandidates(websiteUrl)
  let html: string | null = null
  let pageUrl = ""
  for (const url of candidates) {
    html = await fetchHtml(url)
    if (html) {
      pageUrl = url
      break
    }
  }
  if (!html) {
    return { company_intro: null, investment_philosophy: null, investment_strategy: null }
  }

  let blocks = extractLabeledBlocks(htmlToText(html))
  const missing = SECTION_DEFS.filter((def) => !blocks[def.key])
  if (missing.length === 0) return blocks

  const extraLinks = collectSectionLinks(html, pageUrl)
  for (const link of extraLinks) {
    if (SECTION_DEFS.every((def) => blocks[def.key])) break
    const extraHtml = await fetchHtml(link)
    if (!extraHtml || extraHtml === html) continue
    blocks = mergeBlocks(blocks, extractLabeledBlocks(htmlToText(extraHtml)))
  }
  return blocks
}

export function parseAmacWebsiteUrl(html: string): string | null {
  const labeled = html.match(
    /机构网址\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
  )
  if (!labeled) return normalizeWebsiteUrl(htmlToText(html).match(/机构网址\s+(\S+)/)?.[1] ?? "")
  const raw = labeled[1]
  const href = raw.match(/href=["']([^"']+)["']/i)
  return normalizeWebsiteUrl(href?.[1] ?? htmlToText(raw))
}
