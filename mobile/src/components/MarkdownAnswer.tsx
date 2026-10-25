import React, { useMemo, type ReactNode } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

type Props = {
  content: string
  /** When streaming empty content while busy, show a placeholder glyph. */
  placeholder?: string
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "para"; text: string }

function splitInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<Text key={`t${key++}`}>{text.slice(last, m.index)}</Text>)
    }
    const token = m[0]
    if (token.startsWith("**")) {
      nodes.push(
        <Text key={`t${key++}`} style={styles.bold}>
          {token.slice(2, -2)}
        </Text>,
      )
    } else if (token.startsWith("*")) {
      nodes.push(
        <Text key={`t${key++}`} style={styles.italic}>
          {token.slice(1, -1)}
        </Text>,
      )
    } else {
      nodes.push(
        <Text key={`t${key++}`} style={styles.code}>
          {token.slice(1, -1)}
        </Text>,
      )
    }
    last = m.index + token.length
  }
  if (last < text.length) {
    nodes.push(<Text key={`t${key++}`}>{text.slice(last)}</Text>)
  }
  return nodes.length ? nodes : [<Text key="empty">{text}</Text>]
}

function isTableSep(line: string): boolean {
  const t = line.trim()
  if (!t.includes("|") || !t.includes("-")) return false
  const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|")
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()))
}

function splitRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith("|")) t = t.slice(1)
  if (t.endsWith("|")) t = t.slice(0, -1)
  return t.split("|").map((c) => c.trim())
}

/** Approximate display width: CJK ~2 units, ASCII ~1. */
function displayUnits(text: string): number {
  let n = 0
  for (const ch of text.replace(/\*\*/g, "").replace(/`/g, "")) {
    n += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1
  }
  return n
}

function computeColWidths(headers: string[], rows: string[][]): number[] {
  const cols = Math.max(headers.length, 1)
  const units: number[] = Array.from({ length: cols }, (_, i) => displayUnits(headers[i] || ""))
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      units[i] = Math.max(units[i], displayUnits(row[i] || ""))
    }
  }
  // px per unit at ~13px font; clamp so short codes stay narrow and long names wrap inside a fixed cell.
  return units.map((u) => {
    const ideal = Math.ceil(u * 7.0) + 24
    return Math.min(200, Math.max(64, ideal))
  })
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" })
      i += 1
      continue
    }

    const hm = /^(#{1,4})\s+(.+)$/.exec(trimmed)
    if (hm) {
      blocks.push({ type: "heading", level: hm[1].length, text: hm[2].trim() })
      i += 1
      continue
    }

    if (trimmed.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headers = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length) {
        const rowLine = lines[i]
        if (!rowLine.trim() || !rowLine.includes("|")) break
        if (isTableSep(rowLine)) {
          i += 1
          continue
        }
        const cells = splitRow(rowLine)
        while (cells.length < headers.length) cells.push("")
        rows.push(cells.slice(0, headers.length))
        i += 1
      }
      blocks.push({ type: "table", headers, rows })
      continue
    }

    // Fallback: consecutive pipe-rows without GFM separator (AI sometimes omits ---)
    if (
      /^\|.+\|$/.test(trimmed) &&
      i + 1 < lines.length &&
      /^\|.+\|$/.test(lines[i + 1].trim()) &&
      !isTableSep(lines[i + 1])
    ) {
      const rowsRaw: string[] = []
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        if (!isTableSep(lines[i])) rowsRaw.push(lines[i].trim())
        i += 1
      }
      if (rowsRaw.length >= 2) {
        const headers = splitRow(rowsRaw[0])
        const rows = rowsRaw.slice(1).map((r) => {
          const cells = splitRow(r)
          while (cells.length < headers.length) cells.push("")
          return cells.slice(0, headers.length)
        })
        blocks.push({ type: "table", headers, rows })
        continue
      }
      // not enough rows — fall through as paragraph
      i -= rowsRaw.length
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""))
        i += 1
      }
      blocks.push({ type: "list", ordered: false, items })
      continue
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""))
        i += 1
      }
      blocks.push({ type: "list", ordered: true, items })
      continue
    }

    const para: string[] = [trimmed]
    i += 1
    while (i < lines.length) {
      const n = lines[i].trim()
      if (!n) break
      if (/^(#{1,4})\s+/.test(n)) break
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(n)) break
      if (/^[-*+]\s+/.test(n)) break
      if (/^\d+[.)]\s+/.test(n)) break
      if (n.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) break
      if (/^\|.+\|$/.test(n)) break
      para.push(n)
      i += 1
    }
    blocks.push({ type: "para", text: para.join("\n") })
  }
  return blocks
}

function Inline({ text }: { text: string }) {
  return <Text style={styles.body}>{splitInline(text)}</Text>
}

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const widths = useMemo(() => computeColWidths(headers, rows), [headers, rows])
  const tableWidth = widths.reduce((a, b) => a + b, 0)

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={styles.tableScroll}
      contentContainerStyle={styles.tableScrollContent}
    >
      <View style={[styles.table, { width: tableWidth }]}>
        <View style={[styles.tr, styles.trHead]}>
          {headers.map((h, idx) => (
            <View
              key={`h${idx}`}
              style={[
                styles.td,
                styles.tdHead,
                { width: widths[idx], minWidth: widths[idx], maxWidth: widths[idx] },
                idx === headers.length - 1 ? styles.tdLast : null,
              ]}
            >
              <Text style={styles.thText}>{splitInline(h)}</Text>
            </View>
          ))}
        </View>
        {rows.map((row, rIdx) => (
          <View
            key={`r${rIdx}`}
            style={[
              styles.tr,
              rIdx % 2 === 1 ? styles.trAlt : null,
              rIdx === rows.length - 1 ? styles.trLast : null,
            ]}
          >
            {headers.map((_, cIdx) => (
              <View
                key={`c${rIdx}-${cIdx}`}
                style={[
                  styles.td,
                  {
                    width: widths[cIdx],
                    minWidth: widths[cIdx],
                    maxWidth: widths[cIdx],
                  },
                  cIdx === headers.length - 1 ? styles.tdLast : null,
                ]}
              >
                <Text style={styles.tdText}>{splitInline(row[cIdx] || "")}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

export function MarkdownAnswer({ content, placeholder }: Props) {
  const blocks = useMemo(() => parseBlocks(content || ""), [content])

  if (!content) {
    return <Text style={styles.body}>{placeholder || ""}</Text>
  }

  return (
    <View style={styles.root}>
      {blocks.map((b, idx) => {
        if (b.type === "heading") {
          const hs =
            b.level <= 1
              ? styles.h1
              : b.level === 2
                ? styles.h2
                : b.level === 3
                  ? styles.h3
                  : styles.h4
          return (
            <Text key={idx} style={hs}>
              {splitInline(b.text)}
            </Text>
          )
        }
        if (b.type === "hr") {
          return <View key={idx} style={styles.hr} />
        }
        if (b.type === "table") {
          return <TableBlock key={idx} headers={b.headers} rows={b.rows} />
        }
        if (b.type === "list") {
          return (
            <View key={idx} style={styles.list}>
              {b.items.map((item, j) => (
                <View key={j} style={styles.listItem}>
                  <Text style={styles.bullet}>{b.ordered ? `${j + 1}.` : "•"}</Text>
                  <View style={styles.listBody}>
                    <Inline text={item} />
                  </View>
                </View>
              ))}
            </View>
          )
        }
        return (
          <Text key={idx} style={styles.body}>
            {splitInline(b.text)}
          </Text>
        )
      })}
    </View>
  )
}

const BORDER = "rgba(231,201,138,0.45)"

const styles = StyleSheet.create({
  root: { gap: 10, alignSelf: "stretch" },
  body: { color: "#F3F0EA", fontSize: 16.5, lineHeight: 27 },
  bold: { fontWeight: "700", color: "#FFF6E8" },
  italic: { fontStyle: "italic", color: "#E8E2D6" },
  code: {
    fontFamily: "monospace",
    fontSize: 14,
    color: "#E7C98A",
    backgroundColor: "rgba(231,201,138,0.12)",
  },
  h1: {
    color: "#E7C98A",
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 28,
    marginTop: 4,
  },
  h2: {
    color: "#E7C98A",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 26,
    marginTop: 2,
  },
  h3: {
    color: "#F0D7A8",
    fontSize: 16.5,
    fontWeight: "700",
    lineHeight: 24,
  },
  h4: {
    color: "#F0D7A8",
    fontSize: 15.5,
    fontWeight: "700",
    lineHeight: 22,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(231,201,138,0.35)",
    marginVertical: 4,
    alignSelf: "stretch",
  },
  list: { gap: 4 },
  listItem: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bullet: { color: "#E7C98A", fontSize: 16, lineHeight: 27, width: 18 },
  listBody: { flex: 1 },
  tableScroll: { alignSelf: "stretch", marginVertical: 4 },
  tableScrollContent: { paddingRight: 12, paddingBottom: 4 },
  table: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "rgba(12,14,20,0.7)",
  },
  tr: {
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  trHead: { backgroundColor: "rgba(231,201,138,0.2)" },
  trAlt: { backgroundColor: "rgba(255,255,255,0.035)" },
  trLast: { borderBottomWidth: 0 },
  td: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    justifyContent: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
  },
  tdHead: {},
  tdLast: { borderRightWidth: 0 },
  thText: { color: "#E7C98A", fontSize: 12.5, fontWeight: "700", lineHeight: 17 },
  tdText: { color: "#F3F0EA", fontSize: 12.5, lineHeight: 17 },
})
