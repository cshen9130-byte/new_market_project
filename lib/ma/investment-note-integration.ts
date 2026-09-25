/** Charts and AI brief for a merged 投资笔记. SVG uses presentation attributes only (note HTML strips class/style). */

export type InvestmentNoteIntegrationChange = {
  topic: string
  trend: string
  detail: string
}

export type InvestmentNoteIntegrationPoint = {
  date: string
  value: number
}

export type InvestmentNoteIntegrationSeries = {
  name: string
  unit: string
  points: InvestmentNoteIntegrationPoint[]
}

export type InvestmentNoteIntegrationAnalysis = {
  summary: string
  recentChanges: InvestmentNoteIntegrationChange[]
  focus: string[]
  series: InvestmentNoteIntegrationSeries[]
}

export type RoadshowTimelineBucket = {
  label: string
  count: number
}

export type RoadshowTimelineInput = {
  createdDate?: string
  roadshows?: Array<{ key?: string; date?: string }>
}

const CN_SECTION = ["一", "二", "三", "四", "五", "六", "七", "八"]

export function investmentNotePlainText(html: string, maxChars = 2500): string {
  const text = String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trim()}…`
}

function clampText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

/** Accept the model JSON and drop anything that is not a short factual brief. */
export function parseInvestmentNoteIntegrationAnalysis(raw: unknown): InvestmentNoteIntegrationAnalysis | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const summary = clampText(row.summary, 1200)
  const recentChanges: InvestmentNoteIntegrationChange[] = []
  if (Array.isArray(row.recentChanges)) {
    for (const item of row.recentChanges) {
      if (!item || typeof item !== "object") continue
      const change = item as Record<string, unknown>
      const topic = clampText(change.topic, 40)
      const trend = clampText(change.trend, 12)
      const detail = clampText(change.detail, 240)
      if (!topic || !detail) continue
      recentChanges.push({ topic, trend: trend || "变化", detail })
      if (recentChanges.length >= 8) break
    }
  }
  const focus: string[] = []
  if (Array.isArray(row.focus)) {
    for (const item of row.focus) {
      const line = clampText(item, 160)
      if (!line) continue
      focus.push(line)
      if (focus.length >= 6) break
    }
  }
  const series: InvestmentNoteIntegrationSeries[] = []
  if (Array.isArray(row.series)) {
    for (const item of row.series) {
      if (!item || typeof item !== "object") continue
      const serie = item as Record<string, unknown>
      const name = clampText(serie.name, 24)
      const unit = clampText(serie.unit, 12)
      const points: InvestmentNoteIntegrationPoint[] = []
      if (Array.isArray(serie.points)) {
        for (const point of serie.points) {
          if (!point || typeof point !== "object") continue
          const p = point as Record<string, unknown>
          const date = clampText(p.date, 16)
          const value = typeof p.value === "number" ? p.value : Number(p.value)
          if (!date || !Number.isFinite(value)) continue
          points.push({ date, value })
          if (points.length >= 16) break
        }
      }
      if (!name || points.length < 2) continue
      series.push({ name, unit, points })
      if (series.length >= 4) break
    }
  }
  if (!summary && recentChanges.length === 0 && focus.length === 0 && series.length === 0) return null
  return { summary, recentChanges, focus, series }
}

function monthKey(raw?: string): string | null {
  const text = String(raw ?? "").trim()
  const match = text.match(/(\d{4})[./-](\d{1,2})/)
  if (!match) return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return `${match[1]}/${String(month).padStart(2, "0")}`
}

/** One bar per month: unique linked roadshows, otherwise the note itself. */
export function roadshowTimelineBuckets(notes: RoadshowTimelineInput[]): RoadshowTimelineBucket[] {
  const counts = new Map<string, Set<string>>()
  notes.forEach((note, index) => {
    const fallback = monthKey(note.createdDate)
    const roadshows = note.roadshows ?? []
    let added = false
    roadshows.forEach((item, roadshowIndex) => {
      const month = monthKey(item.date) || fallback
      const key = (item.key || "").trim() || `roadshow-${index}-${roadshowIndex}`
      if (!month) return
      const bucket = counts.get(month) ?? new Set<string>()
      bucket.add(key)
      counts.set(month, bucket)
      added = true
    })
    if (!added && fallback) {
      const bucket = counts.get(fallback) ?? new Set<string>()
      bucket.add(`note-${index}`)
      counts.set(fallback, bucket)
    }
  })
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, keys]) => ({ label, count: keys.size }))
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function roadshowTimelineSvg(buckets: RoadshowTimelineBucket[]): string {
  if (buckets.length === 0) return ""
  const width = 680
  const height = 228
  const padL = 36
  const padR = 16
  const padT = 22
  const padB = 42
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const max = Math.max(...buckets.map((b) => b.count), 1)
  const slot = innerW / buckets.length
  const barW = Math.max(6, Math.min(36, slot * 0.62))
  const labelStep = buckets.length > 14 ? Math.ceil(buckets.length / 10) : 1
  const bars = buckets.map((bucket, index) => {
    const h = Math.max(2, (bucket.count / max) * innerH)
    const x = padL + index * slot + (slot - barW) / 2
    const y = padT + innerH - h
    const showLabel = index % labelStep === 0 || index === buckets.length - 1
    const short = bucket.label.slice(2)
    return [
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="#ef4444" rx="2"/>`,
      bucket.count > 0
        ? `<text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(12, y - 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#3f3f46">${bucket.count}</text>`
        : "",
      showLabel
        ? `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 16}" text-anchor="middle" font-size="10" fill="#71717a">${escapeXml(short)}</text>`
        : "",
    ].join("")
  })
  const grid = [0, 0.5, 1].map((t) => {
    const y = padT + innerH - t * innerH
    const label = t === 0 ? "0" : String(Math.round(max * t))
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="#e4e4e7" stroke-width="1"/><text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#a1a1aa">${label}</text>`
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="路演时间线">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#fafafa" rx="8"/>`,
    ...grid,
    ...bars,
    `<text x="${padL}" y="14" font-size="11" fill="#71717a">路演场次</text>`,
    `</svg>`,
  ].join("")
}

export function metricSeriesSvg(series: InvestmentNoteIntegrationSeries): string {
  const points = series.points
  if (points.length < 2) return ""
  const width = 680
  const height = 200
  const padL = 48
  const padR = 16
  const padT = 18
  const padB = 36
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const values = points.map((p) => p.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    min -= pad
    max += pad
  } else {
    const pad = (max - min) * 0.12
    min -= pad
    max += pad
  }
  const coords = points.map((point, index) => {
    const x = padL + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW)
    const y = padT + ((max - point.value) / (max - min)) * innerH
    return { x, y, point }
  })
  const poly = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")
  const dots = coords.map((c) => {
    const label = Number.isInteger(c.point.value) ? String(c.point.value) : c.point.value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
    return [
      `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="#2563eb"/>`,
      `<text x="${c.x.toFixed(1)}" y="${Math.max(12, c.y - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="#1d4ed8">${escapeXml(label)}</text>`,
      `<text x="${c.x.toFixed(1)}" y="${height - 12}" text-anchor="middle" font-size="10" fill="#71717a">${escapeXml(c.point.date)}</text>`,
    ].join("")
  })
  const unit = series.unit ? `（${escapeXml(series.unit)}）` : ""
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(series.name)}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#fafafa" rx="8"/>`,
    `<text x="${padL}" y="14" font-size="12" fill="#27272a">${escapeXml(series.name)}${unit}</text>`,
    `<polyline fill="none" stroke="#2563eb" stroke-width="2" points="${poly}"/>`,
    ...dots,
    `</svg>`,
  ].join("")
}

function line(text: string): string {
  if (!text) return "<div><br></div>"
  return `<div>${escapeXml(text)}</div>`
}

export function integrationBriefHtml(input: {
  noteCount: number
  roadshowCount: number
  from?: string
  to?: string
  sourceLabel: string
  buckets: RoadshowTimelineBucket[]
  analysis: InvestmentNoteIntegrationAnalysis | null
  analysisError?: string
}): string {
  const blocks: string[] = []
  const take = () => CN_SECTION[blocks.length] ?? String(blocks.length + 1)
  const span = input.from && input.to ? `，时间从 ${input.from} 到 ${input.to}` : ""
  blocks.push(
    [
      `<div><b>${take()}、路演时间线</b></div>`,
      line(`${input.sourceLabel}共 ${input.noteCount} 条笔记，来自 ${input.roadshowCount} 场路演${span}。`),
      roadshowTimelineSvg(input.buckets),
    ].join(""),
  )
  const analysis = input.analysis
  if (analysis?.summary) {
    blocks.push([`<div><b>${take()}、综述</b></div>`, ...analysis.summary.split(/\n+/).map((part) => line(part))].join(""))
  } else if (input.analysisError) {
    blocks.push([`<div><b>${take()}、综述</b></div>`, line("本次未能生成 AI 综述，下方仍保留路演时间线与原文。")].join(""))
  }
  if (analysis && analysis.recentChanges.length > 0) {
    const rows = analysis.recentChanges
      .map(
        (change) =>
          `<tr><td>${escapeXml(change.topic)}</td><td>${escapeXml(change.trend)}</td><td>${escapeXml(change.detail)}</td></tr>`,
      )
      .join("")
    blocks.push(
      [
        `<div><b>${take()}、近期变化</b></div>`,
        `<table><thead><tr><th>主题</th><th>趋势</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`,
      ].join(""),
    )
  }
  if (analysis && analysis.series.length > 0) {
    const charts = analysis.series.map((serie) => metricSeriesSvg(serie)).filter(Boolean).join("")
    if (charts) {
      blocks.push([`<div><b>${take()}、指标走势</b></div>`, line("下图只画出笔记里反复出现、且能对上日期的数字。"), charts].join(""))
    }
  }
  if (analysis && analysis.focus.length > 0) {
    blocks.push(
      [`<div><b>${take()}、后续关注</b></div>`, ...analysis.focus.map((item, index) => line(`${index + 1}. ${item}`))].join(""),
    )
  }
  return blocks.join("")
}
