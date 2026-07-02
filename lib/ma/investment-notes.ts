export type InvestmentNoteAttachment = {
  id: string
  name: string
  size: number
}

export type InvestmentNoteAssociation = {
  category: string
  name: string
  recordNo: string
}

export const ASSOCIATION_CATEGORIES = [
  "私募基金",
  "公募基金",
  "团队自建",
  "私募管理人",
  "公募基金公司",
] as const

export type AssociationCategory = (typeof ASSOCIATION_CATEGORIES)[number]

export const ASSOCIATION_CATEGORY_SHORT: Record<string, string> = {
  私募基金: "私募",
  公募基金: "公募",
  团队自建: "自建",
  私募管理人: "管理人",
  公募基金公司: "基金公司",
}

export function associationDisplayLabel(item: InvestmentNoteAssociation): string {
  const short = ASSOCIATION_CATEGORY_SHORT[item.category] ?? item.category
  return `${item.name}(${short})`
}

export function associationKey(item: InvestmentNoteAssociation): string {
  return `${item.category}::${item.recordNo || item.name}`
}

export type InvestmentNoteContentVariant = "analysis" | "memo" | "plain"

export type InvestmentNote = {
  id: string
  title: string
  content: string
  preview: string
  contentVariant: InvestmentNoteContentVariant
  teamShared: boolean
  tags: string[]
  associations: InvestmentNoteAssociation[]
  attachments: InvestmentNoteAttachment[]
  creator: string
  lastModifiedBy: string
  modifiedDate: string
  createdDate: string
}

const STORAGE_KEY = "dd_investment_notes"
const SEED_VERSION = 3
const VERSION_KEY = "dd_investment_notes_version"

const SAMPLE_NOTES: InvestmentNote[] = [
  {
    id: "sample-1",
    title: "2026/1/30市场拐点? 组合复盘分析",
    preview:
      "2026/1/30南华商品指数创下近期以来单日最大涨幅5.07%，其中黑色系、能化板块贡献主要涨幅。组合层面，CTA策略表现分化，主观多头策略普遍承压...",
    content: `2026/1/30南华商品指数创下近期以来单日最大涨幅5.07%，其中黑色系、能化板块贡献主要涨幅。组合层面，CTA策略表现分化，主观多头策略普遍承压。

短期来看，商品市场波动率抬升，需关注政策预期与海外宏观数据的共振效应。

八、市场监测网站及其风控报告相关改进
风控报告
1. 增加 VaR 沙盘饼图（已完成）
2. 增加期权持仓列表（已完成）
3. 增加 CTA 策略沙盘（制作中）
4. 增加主观多头策略沙盘（制作中）
5. 增加市场中性策略沙盘（制作中）
6. 增加套利策略沙盘（制作中）`,
    contentVariant: "analysis",
    teamShared: true,
    tags: ["市场复盘", "组合分析"],
    associations: [],
    attachments: [],
    creator: "北极",
    lastModifiedBy: "北极",
    modifiedDate: "2026/07/01",
    createdDate: "2026/01/30",
  },
  {
    id: "sample-2",
    title: "仿宋",
    preview: "近期利率债收益率曲线平坦化，短端受资金面扰动较大，长端更多反映经济预期...",
    content: `近期利率债收益率曲线平坦化，短端受资金面扰动较大，长端更多反映经济预期。

建议关注央行公开市场操作节奏及信用利差变化，重点关注短端波动对组合久期管理的影响。`,
    contentVariant: "plain",
    teamShared: true,
    tags: ["债券"],
    associations: [],
    attachments: [],
    creator: "陈家丰",
    lastModifiedBy: "陈家丰",
    modifiedDate: "2026/01/30",
    createdDate: "2026/01/30",
  },
  {
    id: "sample-3",
    title: "言丰",
    preview: "吉利汽车近期发布新款车型，市场关注度提升，需跟踪销量数据与利润率变化...",
    content: `吉利汽车近期发布新款车型，市场关注度提升，需跟踪销量数据与利润率变化。

短期股价波动或受行业竞争加剧影响，建议持续跟踪月度销量与毛利率数据。`,
    contentVariant: "plain",
    teamShared: true,
    tags: ["个股研究"],
    associations: [],
    attachments: [],
    creator: "陈家丰",
    lastModifiedBy: "陈家丰",
    modifiedDate: "2026/01/30",
    createdDate: "2026/01/30",
  },
  {
    id: "sample-4",
    title: "优宗",
    preview: "沈总：短期看 机器学习AI和Agent的应用，股票方向：截面alpha叠加对冲非线性...",
    content: `沈总：

短期看 机器学习AI和Agent的应用

股票方向：截面alpha叠加对冲非线性

阶段：

月内做反转

日间做趋势`,
    contentVariant: "memo",
    teamShared: true,
    tags: ["管理人沟通"],
    associations: [{ category: "私募基金", name: "优宗", recordNo: "" }],
    attachments: [],
    creator: "陈家丰",
    lastModifiedBy: "陈家丰",
    modifiedDate: "2026/01/19",
    createdDate: "2026/01/19",
  },
  {
    id: "mine-sample-1",
    title: "无标题",
    preview: "",
    content: "",
    contentVariant: "plain",
    teamShared: false,
    tags: [],
    associations: [],
    attachments: [],
    creator: "沈聪",
    lastModifiedBy: "沈聪",
    modifiedDate: "2023/01/17",
    createdDate: "2023/01/17",
  },
  {
    id: "mine-sample-2",
    title: "2023/1/30市场观点? 组合收益分析",
    preview:
      "2023/1/30市场观点：组合收益出现明显分化，CTA策略表现优于主观多头，商品指数单日涨幅创近期新高...",
    content: `2023/1/30市场观点：组合收益出现明显分化，CTA策略表现优于主观多头，商品指数单日涨幅创近期新高。

短期来看，需关注商品指数波动对组合回撤的影响，建议加强事前风控指标监测。`,
    contentVariant: "plain",
    teamShared: false,
    tags: ["市场观点"],
    associations: [],
    attachments: [],
    creator: "沈聪",
    lastModifiedBy: "沈聪",
    modifiedDate: "2023/01/30",
    createdDate: "2023/01/30",
  },
]

function readCurrentUserName(): string {
  if (typeof window === "undefined") return "沈聪"
  try {
    const raw = localStorage.getItem("currentUser")
    if (!raw) return "沈聪"
    const user = JSON.parse(raw) as { name?: string }
    return user.name?.trim() || "沈聪"
  } catch {
    return "沈聪"
  }
}

function previewFromContent(content: string): string {
  const line = content.replace(/\s+/g, " ").trim()
  return line.length > 80 ? `${line.slice(0, 80)}...` : line
}

function parseLegacyAssociation(value: string): InvestmentNoteAssociation {
  const match = value.match(/^(.+)\((.+)\)$/)
  if (!match) return { category: "私募基金", name: value, recordNo: "" }
  const name = match[1]
  const short = match[2]
  const category =
    Object.entries(ASSOCIATION_CATEGORY_SHORT).find(([, label]) => label === short)?.[0] ?? "私募基金"
  return { category, name, recordNo: "" }
}

function normalizeAssociations(value: unknown): InvestmentNoteAssociation[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === "string") return parseLegacyAssociation(item)
    const row = item as Partial<InvestmentNoteAssociation>
    return {
      category: row.category ?? "私募基金",
      name: row.name ?? "",
      recordNo: row.recordNo ?? "",
    }
  })
}

function normalizeNote(raw: unknown): InvestmentNote {
  const note = (raw ?? {}) as Partial<InvestmentNote> & { associations?: unknown }
  const now = new Date().toISOString().slice(0, 10).replace(/-/g, "/")
  return {
    id: typeof note.id === "string" && note.id ? note.id : `recovered-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: typeof note.title === "string" ? note.title : "",
    content: typeof note.content === "string" ? note.content : "",
    preview: typeof note.preview === "string" ? note.preview : "",
    contentVariant: note.contentVariant ?? "plain",
    teamShared: typeof note.teamShared === "boolean" ? note.teamShared : false,
    tags: Array.isArray(note.tags) ? note.tags.filter((t): t is string => typeof t === "string") : [],
    associations: normalizeAssociations(note.associations),
    attachments: Array.isArray(note.attachments) ? note.attachments : [],
    creator: typeof note.creator === "string" ? note.creator : "",
    lastModifiedBy: typeof note.lastModifiedBy === "string" ? note.lastModifiedBy : "",
    modifiedDate: typeof note.modifiedDate === "string" ? note.modifiedDate : now,
    createdDate: typeof note.createdDate === "string" ? note.createdDate : now,
  }
}

function trySetLocalStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore quota / security errors */ }
}

function ensureSeedNotes(): InvestmentNote[] {
  if (typeof window === "undefined") return SAMPLE_NOTES.map(normalizeNote)
  try {
    const version = localStorage.getItem(VERSION_KEY)
    if (version !== String(SEED_VERSION)) {
      trySetLocalStorage(STORAGE_KEY, JSON.stringify(SAMPLE_NOTES))
      trySetLocalStorage(VERSION_KEY, String(SEED_VERSION))
      return SAMPLE_NOTES.map(normalizeNote)
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      trySetLocalStorage(STORAGE_KEY, JSON.stringify(SAMPLE_NOTES))
      return SAMPLE_NOTES.map(normalizeNote)
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      trySetLocalStorage(STORAGE_KEY, JSON.stringify(SAMPLE_NOTES))
      return SAMPLE_NOTES.map(normalizeNote)
    }
    return parsed.map((note: unknown) => normalizeNote(note))
  } catch {
    return SAMPLE_NOTES.map(normalizeNote)
  }
}

export function loadInvestmentNotes(): InvestmentNote[] {
  return ensureSeedNotes()
}

export function saveInvestmentNotes(notes: InvestmentNote[]): void {
  if (typeof window === "undefined") return
  trySetLocalStorage(STORAGE_KEY, JSON.stringify(notes))
}

export function listInvestmentNotes(scope: "team" | "mine"): InvestmentNote[] {
  const user = readCurrentUserName()
  const notes = loadInvestmentNotes()
  if (scope === "team") return notes.filter((n) => n.teamShared)
  return notes.filter((n) => n.creator === user)
}

export function getInvestmentNote(id: string): InvestmentNote | null {
  return loadInvestmentNotes().find((n) => n.id === id) ?? null
}

export function createInvestmentNote(
  partial?: Partial<Pick<InvestmentNote, "title" | "content" | "teamShared">>,
): InvestmentNote {
  const now = new Date()
  const isoDate = now.toISOString().slice(0, 10).replace(/-/g, "/")
  const user = readCurrentUserName()
  const content = partial?.content ?? ""
  const title = partial?.title?.trim() || "无标题"
  const note: InvestmentNote = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content,
    preview: previewFromContent(content) || "",
    contentVariant: "plain",
    teamShared: partial?.teamShared ?? false,
    tags: [],
    associations: [],
    attachments: [],
    creator: user,
    lastModifiedBy: user,
    modifiedDate: isoDate,
    createdDate: isoDate,
  }
  saveInvestmentNotes([note, ...loadInvestmentNotes()])
  return note
}

export function updateInvestmentNote(
  id: string,
  patch: Partial<
    Pick<
      InvestmentNote,
      | "title"
      | "content"
      | "contentVariant"
      | "teamShared"
      | "tags"
      | "associations"
      | "attachments"
      | "lastModifiedBy"
      | "modifiedDate"
    >
  >,
): InvestmentNote | null {
  let updated: InvestmentNote | null = null
  const user = readCurrentUserName()
  const next = loadInvestmentNotes().map((note) => {
    if (note.id !== id) return note
    const content = patch.content ?? note.content
    updated = {
      ...note,
      ...patch,
      content,
      preview: patch.content !== undefined ? previewFromContent(content) : note.preview,
      lastModifiedBy: patch.lastModifiedBy ?? user,
      modifiedDate: patch.modifiedDate ?? new Date().toISOString().slice(0, 10).replace(/-/g, "/"),
    }
    return updated
  })
  if (!updated) return null
  saveInvestmentNotes(next)
  return updated
}

export function deleteInvestmentNote(id: string): void {
  saveInvestmentNotes(loadInvestmentNotes().filter((n) => n.id !== id))
}

export function setInvestmentNoteTeamShared(id: string, teamShared: boolean): InvestmentNote | null {
  return updateInvestmentNote(id, { teamShared })
}

export function setInvestmentNoteTags(id: string, tags: string[]): InvestmentNote | null {
  return updateInvestmentNote(id, { tags })
}

export function setInvestmentNoteAssociations(
  id: string,
  associations: InvestmentNoteAssociation[],
): InvestmentNote | null {
  return updateInvestmentNote(id, { associations })
}
