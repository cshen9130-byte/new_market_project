/**
 * Shared AI researcher report export (real OOXML .docx + CJK PDF).
 * Word: ZIP/OOXML .docx (WeChat-openable), not legacy HTML .doc.
 * PDF: jsPDF + subsetted Noto Sans CJK SC so Chinese glyphs render.
 */

import fs from "fs"
import path from "path"
import JSZip from "jszip"

export type ReportExportFormat = "docx" | "pdf"

export type BuildReportExportInput = {
  markdown: string
  title: string
  subjectLine?: string
  managerName?: string
  format: ReportExportFormat | "doc"
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
  | { kind: "table"; headers: string[]; rows: string[][] }

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
      const headers = splitTableRow(rows[0]).map(stripMdInline)
      const body = rows
        .slice(1)
        .filter((r) => !/^\|[\s|:-]+\|$/.test(r))
        .map((r) => {
          const cells = splitTableRow(r).map(stripMdInline)
          while (cells.length < headers.length) cells.push("")
          return cells.slice(0, headers.length)
        })
      if (headers.length) blocks.push({ kind: "table", headers, rows: body })
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
    ...blocks.flatMap((b) => {
      if (b.kind === "table") {
        return [b.headers.join(""), ...b.rows.map((r) => r.join(""))]
      }
      if ("text" in b) return [b.text]
      return [""]
    }),
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
    if (block.kind === "table") {
      ol = 0
      const cols = Math.max(block.headers.length, 1)
      const fontSize = cols >= 8 ? 7 : cols >= 5 ? 8 : 9
      const padX = 1.2
      const padY = 1.0
      const lineH = fontSize * 0.42 + 0.55
      const units = Array.from({ length: cols }, (_, c) => {
        let u = Array.from(block.headers[c] || "").length || 1
        for (const row of block.rows) {
          u = Math.max(u, Array.from(row[c] || "").length || 1)
        }
        return Math.max(1, u)
      })
      const sumU = units.reduce((a, b) => a + b, 0) || 1
      const widths = units.map((u) => Math.max(14, (maxW * u) / sumU))
      const wSum = widths.reduce((a, b) => a + b, 0)
      for (let c = 0; c < cols; c++) widths[c] = (widths[c] / wSum) * maxW

      const cellLines = (text: string, w: number) => {
        doc.setFont("NotoSansSC", "normal")
        doc.setFontSize(fontSize)
        return doc.splitTextToSize(text || " ", Math.max(8, w - padX * 2)) as string[]
      }

      const drawRow = (cells: string[], header: boolean, alt: boolean) => {
        const linesPerCell = cells.map((t, c) => cellLines(t, widths[c]))
        const rowH = Math.max(lineH + padY * 2, ...linesPerCell.map((ls) => ls.length * lineH + padY * 2))
        ensureSpace(rowH + 0.5)
        let x = margin
        for (let c = 0; c < cols; c++) {
          const w = widths[c]
          if (header) doc.setFillColor(46, 116, 181)
          else if (alt) doc.setFillColor(235, 243, 251)
          else doc.setFillColor(255, 255, 255)
          doc.setDrawColor(189, 215, 238)
          doc.setLineWidth(0.2)
          doc.rect(x, y, w, rowH, "FD")
          doc.setFont("NotoSansSC", header ? "bold" : "normal")
          doc.setFontSize(fontSize)
          if (header) doc.setTextColor(255, 255, 255)
          else doc.setTextColor(26, 26, 46)
          let ty = y + padY + fontSize * 0.35
          for (const ln of linesPerCell[c]) {
            doc.text(ln, x + padX, ty)
            ty += lineH
          }
          x += w
        }
        doc.setTextColor(26, 26, 46)
        y += rowH
      }

      drawRow(
        Array.from({ length: cols }, (_, c) => block.headers[c] || ""),
        true,
        false,
      )
      block.rows.forEach((row, rIdx) => {
        drawRow(
          Array.from({ length: cols }, (_, c) => row[c] || ""),
          false,
          rIdx % 2 === 1,
        )
      })
      y += 3
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


function escapeOoxml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

type DocxBlock =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "li"; ordered: boolean; text: string }
  | { kind: "hr" }
  | { kind: "table"; headers: string[]; rows: string[][] }

function markdownToDocxBlocks(md: string): DocxBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n")
  const blocks: DocxBlock[] = []
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
      const joined = parts.filter(Boolean).join(" ")
      if (joined) blocks.push({ kind: "p", text: joined })
      continue
    }
    if (/^\|.+\|$/.test(trimmed)) {
      const rows: string[] = []
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rows.push(lines[i].trim())
        i++
      }
      const headers = splitTableRow(rows[0]).map(stripMdInline)
      const body = rows
        .slice(1)
        .filter((r) => !/^\|[\s|:-]+\|$/.test(r))
        .map((r) => splitTableRow(r).map(stripMdInline))
      blocks.push({ kind: "table", headers, rows: body })
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
      pLines.push(stripMdInline(cur))
      i++
    }
    if (pLines.length) blocks.push({ kind: "p", text: pLines.join(" ") })
  }
  return blocks
}

function wText(text: string, opts?: { bold?: boolean; size?: number; color?: string }): string {
  const size = opts?.size ?? 22 // half-points (11pt)
  const color = opts?.color ? `<w:color w:val="${opts.color}"/>` : ""
  const bold = opts?.bold ? "<w:b/>" : ""
  // Preserve spaces; split by newlines into multiple w:t if needed
  const safe = escapeOoxml(text)
  return `<w:r><w:rPr>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${color}<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/></w:rPr><w:t xml:space="preserve">${safe}</w:t></w:r>`
}

function wParagraph(
  text: string,
  opts?: {
    bold?: boolean
    size?: number
    color?: string
    align?: "left" | "center" | "both"
    before?: number
    after?: number
    shading?: string
  },
): string {
  const align = opts?.align ? `<w:jc w:val="${opts.align}"/>` : ""
  const before = opts?.before != null ? `<w:spacing w:before="${opts.before}" w:after="${opts.after ?? 120}" w:line="360" w:lineRule="auto"/>` : `<w:spacing w:after="${opts?.after ?? 120}" w:line="360" w:lineRule="auto"/>`
  const shd = opts?.shading
    ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shading}"/>`
    : ""
  return `<w:p><w:pPr>${align}${before}${shd}</w:pPr>${wText(text, {
    bold: opts?.bold,
    size: opts?.size,
    color: opts?.color,
  })}</w:p>`
}

function wTable(headers: string[], rows: string[][]): string {
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 1)
  const width = Math.floor(9000 / cols)
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`
  const cell = (text: string, header: boolean) => {
    const fill = header ? "2E74B5" : "FFFFFF"
    const color = header ? "FFFFFF" : "1A1A2E"
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>${wParagraph(text || " ", {
      bold: header,
      size: header ? 20 : 18,
      color,
      after: 60,
    })}</w:tc>`
  }
  const headerRow = `<w:tr>${Array.from({ length: cols }, (_, i) => cell(headers[i] || "", true)).join("")}</w:tr>`
  const body = rows
    .map((row, idx) => {
      const fillRows = idx % 2 === 1
      const cells = Array.from({ length: cols }, (_, i) => {
        const text = row[i] || ""
        if (!fillRows) return cell(text, false)
        return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EBF3FB"/></w:tcPr>${wParagraph(text || " ", {
          size: 18,
          after: 60,
        })}</w:tc>`
      }).join("")
      return `<w:tr>${cells}</w:tr>`
    })
    .join("")
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>
    <w:top w:val="single" w:sz="4" w:color="BDD7EE"/>
    <w:left w:val="single" w:sz="4" w:color="BDD7EE"/>
    <w:bottom w:val="single" w:sz="4" w:color="BDD7EE"/>
    <w:right w:val="single" w:sz="4" w:color="BDD7EE"/>
    <w:insideH w:val="single" w:sz="4" w:color="BDD7EE"/>
    <w:insideV w:val="single" w:sz="4" w:color="BDD7EE"/>
  </w:tblBorders></w:tblPr>${grid}${headerRow}${body}</w:tbl>`
}

export async function buildDocxBuffer(input: {
  markdown: string
  title: string
  subjectLine?: string
  dateStr?: string
}): Promise<Buffer> {
  const dateStr =
    input.dateStr ??
    new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })
  const subjectLine = input.subjectLine?.trim() || input.title
  const blocks = markdownToDocxBlocks(input.markdown)
  const parts: string[] = []
  parts.push(wParagraph(input.title, { bold: true, size: 36, color: "1F3864", align: "center", after: 80 }))
  parts.push(wParagraph(subjectLine, { size: 24, color: "2E74B5", align: "center", after: 40 }))
  parts.push(
    wParagraph(`生成日期：${dateStr}  |  AI 研究员自动生成  |  仅供内部参考`, {
      size: 18,
      color: "888888",
      align: "center",
      after: 280,
    }),
  )
  for (const block of blocks) {
    if (block.kind === "h") {
      if (block.level <= 1) {
        parts.push(
          wParagraph(block.text, {
            bold: true,
            size: 28,
            color: "FFFFFF",
            shading: "2E74B5",
            before: 240,
            after: 120,
          }),
        )
      } else if (block.level === 2) {
        parts.push(wParagraph(block.text, { bold: true, size: 24, color: "2E74B5", before: 200, after: 100 }))
      } else {
        parts.push(wParagraph(block.text, { bold: true, size: 22, color: "1F3864", before: 160, after: 80 }))
      }
    } else if (block.kind === "p") {
      parts.push(wParagraph(block.text, { size: 22, align: "both", after: 100 }))
    } else if (block.kind === "li") {
      const prefix = block.ordered ? "• " : "• "
      parts.push(wParagraph(`${prefix}${block.text}`, { size: 22, after: 60 }))
    } else if (block.kind === "hr") {
      parts.push(wParagraph(" ", { size: 18, after: 80 }))
    } else if (block.kind === "table") {
      parts.push(wTable(block.headers, block.rows))
      parts.push(wParagraph(" ", { size: 10, after: 80 }))
    }
  }
  parts.push(
    wParagraph(
      "免责声明：本报告由 AI 研究员系统基于结构化数据库与知识库文档自动生成，未经人工审核。文中财务数据均已标注来源；投资决策请以管理人的净值报告、信披确认函等正式披露文件为准。本报告不构成投资建议。",
      { size: 18, color: "666666", before: 280, after: 120 },
    ),
  )
  parts.push(
    wParagraph(`量化母基金私募管理人研究平台  ·  AI 研究员系统  ·  ${dateStr}`, {
      size: 16,
      color: "999999",
      align: "center",
      after: 40,
    }),
  )

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">
  <w:body>
    ${parts.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
</w:styles>`

  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypes)
  zip.folder("_rels")!.file(".rels", rels)
  const word = zip.folder("word")!
  word.file("document.xml", documentXml)
  word.file("styles.xml", styles)
  word.folder("_rels")!.file("document.xml.rels", docRels)
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })
  return Buffer.from(out)
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
  const format = input.format === "doc" ? "docx" : input.format
  if (format === "pdf") {
    const buffer = await buildPdfBuffer({
      markdown: input.markdown,
      title: input.title,
      subjectLine: input.subjectLine,
    })
    return { filename: `${base}.pdf`, mime: "application/pdf", buffer }
  }
  const buffer = await buildDocxBuffer({
    markdown: input.markdown,
    title: input.title,
    subjectLine: input.subjectLine,
  })
  return {
    filename: `${base}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  }
}
