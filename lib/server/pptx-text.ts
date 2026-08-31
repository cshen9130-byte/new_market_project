/**
 * Extract visible text from Office Open XML PowerPoint files (.pptx and siblings).
 * These are ZIP packages; slide copy lives in ppt/slides/slideN.xml as <a:t> runs.
 */

import AdmZip from "adm-zip"

export const PPTX_OOXML_EXTENSIONS = new Set([
  ".pptx",
  ".pptm",
  ".ppsx",
  ".ppsm",
  ".potx",
  ".potm",
])

const SLIDE_ENTRY_RE = /^ppt\/slides\/slide(\d+)\.xml$/i
const DRAWING_TEXT_RE = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function textsFromSlideXml(xml: string): string {
  const parts: string[] = []
  DRAWING_TEXT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DRAWING_TEXT_RE.exec(xml))) {
    const text = decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim()
    if (text) parts.push(text)
  }
  return parts.join(" ")
}

export function isPptxOpenXmlExtension(ext: string): boolean {
  return PPTX_OOXML_EXTENSIONS.has(String(ext || "").toLowerCase())
}

export function extractPptxText(buffer: Buffer): string {
  if (!buffer?.length) return ""
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch {
    throw new Error("无法读取 PPTX 文件")
  }

  const slides: Array<{ n: number; text: string }> = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = String(entry.entryName || "").replace(/\\/g, "/")
    const match = name.match(SLIDE_ENTRY_RE)
    if (!match) continue
    const xml = entry.getData().toString("utf8")
    const text = textsFromSlideXml(xml)
    if (text) slides.push({ n: Number(match[1]), text })
  }
  slides.sort((a, b) => a.n - b.n)
  return slides
    .map((slide, index) => `第${index + 1}页\n${slide.text}`)
    .join("\n\n")
    .trim()
}
