/**
 * Shared AI researcher report export (Word HTML .doc + CJK PDF).
 * Word: UTF-8 HTML Word (.doc) matching dashboard AI researcher styling.
 * PDF: jsPDF + subsetted Noto Sans CJK SC so Chinese glyphs render.
 */

import fs from "fs"
import path from "path"

export type ReportExportFormat = "doc" | "pdf"

export type BuildReportExportInput = {
  markdown: string
  title: string
  subjectLine?: string
  managerName?: string
  format: ReportExportFormat
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function splitTableRow(row: string): string[] {
  return row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
}

function inlineMd(text: string): string {
  const BR = "\x00BR\x00"
  return text
    .replace(/<br\s*\/?>/gi, BR)
    .replace(/&lt;br\s*\/?&gt;/gi, BR)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(new RegExp(BR, "g"), "<br>")
}

export function mdToWordHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []
  let i = 0
  let rowIndex = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      i++
      continue
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      out.push("<hr>")
      i++
      continue
    }

    const hm = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (hm) {
      const lv = hm[1].length
      out.push(`<h${lv}>${inlineMd(hm[2])}</h${lv}>`)
      i++
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const bqLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        bqLines.push(lines[i].trim().replace(/^>\s?/, ""))
        i++
      }
      const filtered = bqLines.filter((l) => l.trim() !== "-" && l.trim() !== "")
      if (filtered.length > 0) {
        out.push(`<blockquote>${filtered.map((l) => inlineMd(l)).join("<br>")}</blockquote>`)
      }
      continue
    }

    if (/^\|.+\|$/.test(trimmed)) {
      const rows: string[] = []
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rows.push(lines[i].trim())
        i++
      }
      const headerCells = splitTableRow(rows[0])
      const bodyRows = rows.slice(1).filter((r) => !/^\|[\s|:-]+\|$/.test(r))
      out.push(
        `<table><thead><tr>${headerCells.map((c) => `<th>${inlineMd(c)}</th>`).join("")}</tr></thead><tbody>`,
      )
      rowIndex = 0
      for (const row of bodyRows) {
        const cls = rowIndex % 2 === 1 ? ' class="even-row"' : ""
        const cells = splitTableRow(row)
        out.push(`<tr${cls}>${cells.map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`)
        rowIndex++
      }
      out.push("</tbody></table>")
      continue
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      out.push("<ul>")
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        const text = lines[i].trim().replace(/^[-*+]\s+/, "")
        out.push(`<li>${inlineMd(text)}</li>`)
        i++
      }
      out.push("</ul>")
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      out.push("<ol>")
      while (i < lines.length) {
        const cur = lines[i].trim()
        if (/^\d+\.\s+/.test(cur)) {
          out.push(`<li>${inlineMd(cur.replace(/^\d+\.\s+/, ""))}</li>`)
          i++
        } else if (/^[-*+]\s+/.test(cur)) {
          out.push(
            `<li style="list-style-type:disc;margin-left:14pt">${inlineMd(cur.replace(/^[-*+]\s+/, ""))}</li>`,
          )
          i++
        } else {
          break
        }
      }
      out.push("</ol>")
      continue
    }

    const pLines: string[] = []
    while (i < lines.length) {
      const cur = lines[i].trim()
      if (!cur) break
      if (/^(#{1,6}\s|[-*_]{3,}$|>\s?|\|.+\||[-*+]\s|\d+\.\s)/.test(cur)) break
      pLines.push(cur)
      i++
    }
    if (pLines.length > 0) {
      out.push(`<p>${inlineMd(pLines.join(" "))}</p>`)
    }
  }
  return out.join("\n")
}

const WORD_CSS = `
      @page { size: A4; margin: 2.5cm 2.8cm 2.5cm 2.8cm; }
      body {
        font-family: "微软雅黑", "Microsoft YaHei", "宋体", SimSun, sans-serif;
        font-size: 11pt; color: #1a1a2e; margin: 0; line-height: 1.75;
      }
      .cover-title {
        text-align: center; font-size: 22pt; font-weight: bold;
        color: #1F3864; margin: 30pt 0 6pt; letter-spacing: 1pt;
      }
      .cover-sub {
        text-align: center; font-size: 12pt; color: #2E74B5;
        margin-bottom: 4pt; font-weight: normal;
      }
      .cover-meta {
        text-align: center; font-size: 10pt; color: #888;
        margin-bottom: 30pt; border-bottom: 2pt solid #2E74B5; padding-bottom: 12pt;
      }
      h1 {
        font-size: 16pt; font-weight: bold; color: #1F3864;
        margin: 20pt 0 6pt; text-align: center;
        border-bottom: 2pt solid #2E74B5; padding-bottom: 6pt; display: none;
      }
      h2 {
        font-size: 13pt; font-weight: bold; color: #ffffff;
        background-color: #2E74B5; padding: 5pt 10pt;
        margin: 18pt 0 8pt; border-left: 5pt solid #1F3864;
      }
      h3 {
        font-size: 11.5pt; font-weight: bold; color: #2E74B5;
        margin: 12pt 0 5pt; border-left: 3pt solid #BDD7EE; padding-left: 7pt;
      }
      h4 { font-size: 11pt; font-weight: bold; color: #1F3864; margin: 8pt 0 4pt; }
      p { margin: 5pt 0; text-align: justify; }
      table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 10pt; }
      thead tr { background-color: #2E74B5; color: #ffffff; }
      th {
        padding: 6pt 8pt; font-weight: bold; text-align: left; color: #ffffff;
        border: 1pt solid #1F3864; font-size: 10pt;
      }
      td { padding: 5pt 8pt; border: 1pt solid #BDD7EE; vertical-align: top; }
      tr.even-row td { background-color: #EBF3FB; }
      blockquote {
        border-left: 4pt solid #2E74B5; background: #F4F9FD;
        padding: 8pt 12pt; margin: 8pt 0; color: #333;
        font-size: 10.5pt; font-style: normal;
      }
      hr { border: none; border-top: 1pt solid #BDD7EE; margin: 14pt 0; }
      ul { margin: 4pt 0 6pt 0; padding-left: 18pt; }
      ol { margin: 4pt 0 6pt 0; padding-left: 18pt; }
      li { margin-bottom: 4pt; }
      strong { font-weight: bold; color: #1F3864; }
      code {
        font-family: Consolas, monospace; background: #f0f0f0;
        padding: 1pt 4pt; font-size: 9.5pt; border-radius: 2pt;
      }
      .footer {
        margin-top: 30pt; border-top: 1pt solid #BDD7EE;
        padding-top: 8pt; text-align: center; color: #999; font-size: 9pt;
      }
      .disclaimer {
        background: #FFF8E1; border-left: 4pt solid #FFC107;
        padding: 8pt 12pt; margin: 12pt 0; font-size: 10pt; color: #555;
      }
    `

export function buildWordHtmlDocument(input: {
  markdown: string
  title: string
  subjectLine?: string
  dateStr?: string
}): string {
  const dateStr =
    input.dateStr ??
    new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })
  const subjectLine = input.subjectLine?.trim() || input.title
  const bodyHtml = mdToWordHtml(input.markdown)
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta charset="utf-8">
        <title>${escapeXml(input.title)}</title>
        <!--[if gte mso 9]><xml>
          <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument>
        </xml><![endif]-->
        <style>${WORD_CSS}</style>
      </head>
      <body>
        <p class="cover-title">${escapeXml(input.title)}</p>
        <p class="cover-sub">${escapeXml(subjectLine)}</p>
        <p class="cover-meta">编制日期：${escapeXml(dateStr)} &nbsp;|&nbsp; AI 研究员自动生成 &nbsp;|&nbsp; 仅供内部参考</p>
        ${bodyHtml}
        <div class="disclaimer">
          <strong>免责声明：</strong>本报告由 AI 研究员系统依据结构化数据库与知识库文档自动生成，未经人工审核。所有存疑数据均已标注，投资决策请以经审计的净值报告、托管行确认函及管理人正式披露文件为最终依据，本报告不构成投资建议。
        </div>
        <div class="footer">编制机构：私募基金策略研究部 &nbsp;·&nbsp; AI 研究员系统 &nbsp;·&nbsp; ${escapeXml(dateStr)}</div>
      </body>
    </html>`
}

function stripMdInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .trim()
}

type PdfBlock =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "li"; ordered: boolean; text: string }
  | { kind: "hr" }

function markdownToPdfBlocks(md: string): PdfBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n")
  const blocks: PdfBlock[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      i++
      continue
    }
    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push({ kind: "hr" })
      i++
      continue
    }
    const hm = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (hm) {
      blocks.push({ kind: "h", level: hm[1].length, text: stripMdInline(hm[2]) })
      i++
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      const parts: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        parts.push(stripMdInline(lines[i].trim().replace(/^>\s?/, "")))
        i++
      }
      const text = parts.filter(Boolean).join(" ")
      if (text) blocks.push({ kind: "p", text })
      continue
    }
    if (/^\|.+\|$/.test(trimmed)) {
      const rows: string[] = []
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rows.push(lines[i].trim())
        i++
      }
      for (const row of rows) {
        if (/^\|[\s|:-]+\|$/.test(row)) continue
        const cells = splitTableRow(row).map(stripMdInline).filter(Boolean)
        if (cells.length) blocks.push({ kind: "p", text: cells.join("  |  ") })
      }
      continue
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        blocks.push({
          kind: "li",
          ordered: false,
          text: stripMdInline(lines[i].trim().replace(/^[-*+]\s+/, "")),
        })
        i++
      }
      continue
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        blocks.push({
          kind: "li",
          ordered: true,
          text: stripMdInline(lines[i].trim().replace(/^\d+\.\s+/, "")),
        })
        i++
      }
      continue
    }
    const pLines: string[] = []
    while (i < lines.length) {
      const cur = lines[i].trim()
      if (!cur) break
      if (/^(#{1,6}\s|[-*_]{3,}$|>\s?|\|.+\||[-*+]\s|\d+\.\s)/.test(cur)) break
      pLines.push(cur)
      i++
    }
    if (pLines.length) blocks.push({ kind: "p", text: stripMdInline(pLines.join(" ")) })
  }
  return blocks
}

const CJK_FONT_URL =
  "https://cdn.jsdelivr.net/gh/indigofeather/fonts@master/NotoSansCJKsc-Regular.ttf"
const CJK_FONT_NAME = "NotoSansCJKsc-Regular.ttf"

let cachedFullFont: Buffer | null = null

function cjkFontCandidates(): string[] {
  const cwd = process.cwd()
  return [
    path.join(cwd, "assets", "fonts", CJK_FONT_NAME),
    path.join(cwd, "public", "fonts", CJK_FONT_NAME),
    path.join(__dirname, "..", "..", "assets", "fonts", CJK_FONT_NAME),
  ]
}

async function loadCjkFontBuffer(): Promise<Buffer> {
  if (cachedFullFont) return cachedFullFont

  for (const candidate of cjkFontCandidates()) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 1_000_000) {
        cachedFullFont = fs.readFileSync(candidate)
        return cachedFullFont
      }
    } catch {
      // try next
    }
  }

  const destDir = path.join(process.cwd(), "assets", "fonts")
  const dest = path.join(destDir, CJK_FONT_NAME)
  fs.mkdirSync(destDir, { recursive: true })
  const res = await fetch(CJK_FONT_URL)
  if (!res.ok) {
    throw new Error(`下载中文字体失败: HTTP ${res.status}`)
  }
  const ab = await res.arrayBuffer()
  const buf = Buffer.from(ab)
  if (buf.length < 1_000_000) {
    throw new Error(`下载的中文字体过小（${buf.length} bytes），可能不是有效 TTF`)
  }
  fs.writeFileSync(dest, buf)
  cachedFullFont = buf
  return buf
}

async function subsetCjkFontBase64(textForGlyphs: string): Promise<string> {
  const full = await loadCjkFontBuffer()
  // Always include ASCII + common punctuation so dates/numbers never go missing.
  const seed =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
    " .,;:!?()[]{}<>/@#$%&*+-=_|\\\"'`~^" +
    "，。、；：？！（）【】《》—…·「」『』￥"
  const unique = Array.from(new Set((seed + textForGlyphs).split(""))).join("")
  const subsetFont = (await import("subset-font")).default as (
    buf: Buffer,
    text: string,
    opts: { targetFormat: string },
  ) => Promise<Buffer>
  const subset = await subsetFont(full, unique, { targetFormat: "sfnt" })
  return subset.toString("base64")
}

export async function buildPdfBuffer(input: {
  markdown: string
  title: string
  subjectLine?: string
}): Promise<Buffer> {
  const { jsPDF } = await import("jspdf")
  const dateStr = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const blocks = markdownToPdfBlocks(input.markdown)
  const glyphText = [
    input.title,
    input.subjectLine || "",
    dateStr,
    "编制日期",
    "AI 研究员自动生成",
    "仅供内部参考",
    "免责声明：本报告由 AI 研究员系统自动生成，未经人工审核，不构成投资建议。",
    ...blocks.map((b) => ("text" in b ? b.text : "")),
  ].join("\n")

  const fontB64 = await subsetCjkFontBase64(glyphText)
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" })
  doc.addFileToVFS("NotoSansSC.ttf", fontB64)
  doc.addFont("NotoSansSC.ttf", "NotoSansSC", "normal")
  doc.addFont("NotoSansSC.ttf", "NotoSansSC", "bold")

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 16
  const maxW = pageW - margin * 2
  let y = margin

  const ensureSpace = (need: number) => {
    if (y + need <= pageH - margin) return
    doc.addPage()
    y = margin
  }

  const writeWrapped = (
    text: string,
    fontSize: number,
    style: "normal" | "bold",
    gapAfter: number,
  ) => {
    doc.setFont("NotoSansSC", style)
    doc.setFontSize(fontSize)
    const lines = doc.splitTextToSize(text || " ", maxW) as string[]
    for (const line of lines) {
      ensureSpace(fontSize * 0.45 + 1)
      doc.text(line, margin, y)
      y += fontSize * 0.45 + 0.8
    }
    y += gapAfter
  }

  writeWrapped(input.title, 16, "bold", 2)
  if (input.subjectLine) writeWrapped(input.subjectLine, 11, "normal", 1)
  writeWrapped(`编制日期：${dateStr}  |  AI 研究员自动生成  |  仅供内部参考`, 9, "normal", 4)

  let ol = 0
  for (const block of blocks) {
    if (block.kind === "hr") {
      ensureSpace(4)
      doc.setDrawColor(180)
      doc.line(margin, y, pageW - margin, y)
      y += 4
      continue
    }
    if (block.kind === "h") {
      const size = block.level <= 1 ? 14 : block.level === 2 ? 12 : 11
      writeWrapped(block.text, size, "bold", 2)
      ol = 0
      continue
    }
    if (block.kind === "li") {
      if (block.ordered) {
        ol += 1
        writeWrapped(`${ol}. ${block.text}`, 10, "normal", 1)
      } else {
        writeWrapped(`• ${block.text}`, 10, "normal", 1)
      }
      continue
    }
    ol = 0
    writeWrapped(block.text, 10, "normal", 2)
  }

  ensureSpace(14)
  y += 2
  writeWrapped(
    "免责声明：本报告由 AI 研究员系统自动生成，未经人工审核，不构成投资建议。",
    8,
    "normal",
    0,
  )

  const arrayBuffer = doc.output("arraybuffer") as ArrayBuffer
  return Buffer.from(arrayBuffer)
}

export function sanitizeExportFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "").slice(0, 60) || "管理人画像"
}

export async function buildReportExport(input: BuildReportExportInput): Promise<{
  filename: string
  mime: string
  buffer: Buffer
}> {
  const managerPart = sanitizeExportFilename(input.managerName || input.title || "管理人")
  const base = `${managerPart}-管理人画像`
  if (input.format === "pdf") {
    const buffer = await buildPdfBuffer({
      markdown: input.markdown,
      title: input.title,
      subjectLine: input.subjectLine,
    })
    return { filename: `${base}.pdf`, mime: "application/pdf", buffer }
  }
  const html = buildWordHtmlDocument({
    markdown: input.markdown,
    title: input.title,
    subjectLine: input.subjectLine,
  })
  const buffer = Buffer.from(`\uFEFF${html}`, "utf8")
  return {
    filename: `${base}.doc`,
    mime: "application/msword",
    buffer,
  }
}
