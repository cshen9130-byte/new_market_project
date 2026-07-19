"use client"

import { useMemo, type ReactNode } from "react"
import { cn } from "@/lib/utils"

const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/
const HEADING_RE = /^(#{1,6})\s+(.+)$/
const UL_RE = /^[-*+]\s+(.+)$/
const OL_RE = /^\d+\.\s+(.+)$/
const BLOCKQUOTE_RE = /^>\s?(.*)$/
const TABLE_ROW_RE = /^\|.+\|$/
const TABLE_SEP_RE = /^\|[\s|:-]+\|$/
/** Split plain text on <br> / &lt;br&gt; into React text + real line breaks. */
function formatPlainTextWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  // Fresh regex each call — avoids lastIndex reuse on a shared /g pattern.
  const parts = text.split(/(?:<br\s*\/?>|&lt;br\s*\/?&gt;)/gi)
  if (parts.length === 1) return [text]
  const nodes: ReactNode[] = []
  parts.forEach((part, i) => {
    if (i > 0) nodes.push(<br key={`${keyPrefix}-br-${i}`} />)
    if (part) nodes.push(<span key={`${keyPrefix}-t-${i}`}>{part}</span>)
  })
  return nodes
}

function formatInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let partIndex = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...formatPlainTextWithBreaks(
          text.slice(lastIndex, match.index),
          `${keyPrefix}-text-${partIndex++}`,
        ),
      )
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      nodes.push(
        <img
          key={`${keyPrefix}-img-${partIndex++}`}
          src={match[2]}
          alt={match[1]}
          className="my-2 inline-block max-h-80 max-w-full rounded-md border object-contain"
        />,
      )
    } else if (match[3] !== undefined && match[4] !== undefined) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${partIndex++}`}
          href={match[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {match[3]}
        </a>,
      )
    } else if (match[5] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-bold-${partIndex++}`}>
          {formatPlainTextWithBreaks(match[5], `${keyPrefix}-bold-${partIndex}`)}
        </strong>,
      )
    } else if (match[6] !== undefined) {
      nodes.push(
        <em key={`${keyPrefix}-em-${partIndex++}`}>
          {formatPlainTextWithBreaks(match[6], `${keyPrefix}-em-${partIndex}`)}
        </em>,
      )
    } else if (match[7] !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${partIndex++}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
        >
          {match[7]}
        </code>,
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(
      ...formatPlainTextWithBreaks(text.slice(lastIndex), `${keyPrefix}-text-${partIndex++}`),
    )
  }

  return nodes.length > 0 ? nodes : formatPlainTextWithBreaks(text, keyPrefix)
}

function parseTableRow(line: string): string[] {
  // Strip leading/trailing | and split on |
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())
}

function renderMarkdownBlocks(content: string): ReactNode[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let index = 0
  let blockKey = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const imageMatch = trimmed.match(IMAGE_LINE_RE)
    if (imageMatch) {
      const key = blockKey++
      blocks.push(
        <figure key={`block-${key}`} className="my-3">
          <img
            src={imageMatch[2]}
            alt={imageMatch[1]}
            className="max-h-[480px] max-w-full rounded-md border object-contain"
          />
          {imageMatch[1] ? (
            <figcaption className="mt-1 text-xs text-muted-foreground">{imageMatch[1]}</figcaption>
          ) : null}
        </figure>,
      )
      index += 1
      continue
    }

    const headingMatch = trimmed.match(HEADING_RE)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2]
      const className =
        level === 1
          ? "text-xl font-bold mt-6 mb-3 border-b pb-1"
          : level === 2
            ? "text-lg font-semibold mt-5 mb-2"
            : level === 3
              ? "text-base font-semibold mt-4 mb-1.5"
              : "text-sm font-semibold mt-3 mb-1"
      const key = blockKey++
      blocks.push(
        <div key={`block-${key}`} className={cn("my-2", className)}>
          {formatInlineMarkdown(text, `h-${key}`)}
        </div>,
      )
      index += 1
      continue
    }

    const blockquoteMatch = trimmed.match(BLOCKQUOTE_RE)
    if (blockquoteMatch) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const current = lines[index].trim()
        const quoteLine = current.match(BLOCKQUOTE_RE)
        if (!quoteLine) break
        quoteLines.push(quoteLine[1])
        index += 1
      }
      const key = blockKey++
      blocks.push(
        <blockquote
          key={`block-${key}`}
          className="my-2 border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={quoteIndex} className="leading-6">
              {formatInlineMarkdown(quoteLine, `q-${key}-${quoteIndex}`)}
            </p>
          ))}
        </blockquote>,
      )
      continue
    }

    // ── Markdown pipe tables ───────────────────────────────────────────────────
    if (TABLE_ROW_RE.test(trimmed)) {
      const allRows: string[] = []
      while (index < lines.length) {
        const cur = lines[index].trim()
        if (!TABLE_ROW_RE.test(cur)) break
        allRows.push(cur)
        index += 1
      }

      // First non-separator row is the header; skip separator rows
      const headerRow = allRows[0]
      const headers = parseTableRow(headerRow)
      const bodyRows = allRows.slice(1).filter((r) => !TABLE_SEP_RE.test(r))

      const key = blockKey++
      blocks.push(
        <div key={`block-${key}`} className="my-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border bg-muted/40">
                {headers.map((cell, ci) => (
                  <th
                    key={ci}
                    className="px-3 py-2 text-left text-xs font-semibold text-foreground align-bottom"
                  >
                    {formatInlineMarkdown(cell, `th-${key}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => {
                const cells = parseTableRow(row)
                return (
                  <tr
                    key={ri}
                    className={cn("border-b border-border/60", ri % 2 === 1 ? "bg-muted/20" : "")}
                  >
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-1.5 text-xs">
                        {formatInlineMarkdown(cell, `td-${key}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const ulMatch = trimmed.match(UL_RE)
    if (ulMatch) {
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index].trim()
        const item = current.match(UL_RE)
        if (!item) break
        items.push(item[1])
        index += 1
      }
      const key = blockKey++
      blocks.push(
        <ul key={`block-${key}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="leading-6">
              {formatInlineMarkdown(item, `ul-${key}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }

    const olMatch = trimmed.match(OL_RE)
    if (olMatch) {
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index].trim()
        const item = current.match(OL_RE)
        if (!item) break
        items.push(item[1])
        index += 1
      }
      const key = blockKey++
      blocks.push(
        <ol key={`block-${key}`} className="my-2 list-decimal space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="leading-6">
              {formatInlineMarkdown(item, `ol-${key}-${itemIndex}`)}
            </li>
          ))}
        </ol>,
      )
      continue
    }

    const paragraphLines: string[] = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index]
      const nextTrimmed = next.trim()
      if (
        !nextTrimmed ||
        IMAGE_LINE_RE.test(nextTrimmed) ||
        HEADING_RE.test(nextTrimmed) ||
        BLOCKQUOTE_RE.test(nextTrimmed) ||
        UL_RE.test(nextTrimmed) ||
        OL_RE.test(nextTrimmed) ||
        TABLE_ROW_RE.test(nextTrimmed)
      ) {
        break
      }
      paragraphLines.push(next)
      index += 1
    }

    const key = blockKey++
    blocks.push(
      <p key={`block-${key}`} className="my-2 whitespace-pre-wrap leading-6">
        {formatInlineMarkdown(paragraphLines.join("\n"), `p-${key}`)}
      </p>,
    )
  }

  return blocks
}

type MarkdownNotePreviewProps = {
  content: string
  className?: string
  emptyText?: string
}

export function MarkdownNotePreview({
  content,
  className,
  emptyText = "暂无内容",
}: MarkdownNotePreviewProps) {
  const blocks = useMemo(() => renderMarkdownBlocks(content), [content])

  if (!content.trim()) {
    return (
      <div className={cn("flex h-full items-center justify-center text-sm text-muted-foreground", className)}>
        {emptyText}
      </div>
    )
  }

  return (
    <div className={cn("h-full overflow-auto px-1 py-2 text-sm", className)}>
      {blocks}
    </div>
  )
}
