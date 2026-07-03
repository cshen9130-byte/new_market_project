import seedRows from "./due-diligence-table-seed.json"

export type DueDiligenceTableRowData = {
  ddPersonnel: string
  ddDate: string
  ddTime: string
  ddMethod: string
  ddTarget: string
  recommender: string
  strategyPreliminary: string
  fundCompany: string
  investmentManager: string
  representativeProduct: string
  strategyLevel1: string
  strategyLevel2: string
  strategyLevel3: string
  inTrackingPool: string
  ddMaterials: string
  otherInfo: string
  ddConclusion: string
}

export type DueDiligenceTableRow = DueDiligenceTableRowData & {
  id: string
  createdAt: string
  updatedAt: string
  /** Reserved for future link to fund database records */
  fundId?: string
  /** Linked private fund beian_hao for 代表产品 column */
  representativeProductBeianHao?: string
}

export type DueDiligenceTableRowPatch = Partial<DueDiligenceTableRowData> & {
  representativeProductBeianHao?: string | null
}

export function privateFundProductHref(beianHao: string): string {
  return `/ma/dashboard/private-funds/${encodeURIComponent(beianHao)}`
}

export type DueDiligenceTableColumn = {
  key: keyof DueDiligenceTableRowData
  label: string
  /** Fixed pixel width for table-layout:fixed */
  width: number
  multiline?: boolean
}

export const DD_TABLE_COLUMNS: DueDiligenceTableColumn[] = [
  { key: "ddPersonnel",        label: "尽调人员",      width: 68 },
  { key: "ddDate",             label: "尽调日期",      width: 80 },
  { key: "ddTime",             label: "尽调时间",      width: 56 },
  { key: "ddMethod",           label: "尽调形式",      width: 72 },
  { key: "ddTarget",           label: "尽调对象",      width: 110 },
  { key: "recommender",        label: "推荐人",        width: 60 },
  { key: "strategyPreliminary",label: "策略初筛",      width: 68 },
  { key: "fundCompany",        label: "基金公司",      width: 90 },
  { key: "investmentManager",  label: "投资经理",      width: 90 },
  { key: "representativeProduct", label: "代表产品",   width: 100 },
  { key: "strategyLevel1",     label: "一级策略",      width: 68 },
  { key: "strategyLevel2",     label: "二级策略",      width: 68 },
  { key: "strategyLevel3",     label: "三级策略",      width: 90 },
  { key: "inTrackingPool",     label: "是否加入跟踪池", width: 94 },
  { key: "ddMaterials",        label: "尽调材料",      width: 68 },
  { key: "otherInfo",          label: "其他补充信息",  width: 150, multiline: true },
  { key: "ddConclusion",       label: "尽调结论",      width: 200, multiline: true },
]

export const TABLE_INDEX_WIDTH = 36
export const TABLE_ACTION_WIDTH = 36

/** Total natural width of all columns at 1× zoom. */
export function getDueDiligenceTableNaturalWidth(): number {
  return (
    TABLE_INDEX_WIDTH +
    TABLE_ACTION_WIDTH +
    DD_TABLE_COLUMNS.reduce((sum, col) => sum + col.width, 0)
  )
}

// ── Cell formatting ────────────────────────────────────────────────────────

export type CellFormat = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  /** CSS hex color for text, e.g. "#e00000" */
  color?: string
  /** CSS hex color for cell background */
  bgColor?: string
  align?: "left" | "center" | "right"
  /** Font size in px */
  fontSize?: number
}

export type TableCellFormats = Record<string, CellFormat>

export function isEmptyCellFormat(fmt: CellFormat | undefined): boolean {
  if (!fmt) return true
  return (
    !fmt.bold &&
    !fmt.italic &&
    !fmt.underline &&
    !fmt.strikethrough &&
    !fmt.color &&
    !fmt.bgColor &&
    !fmt.align &&
    !fmt.fontSize
  )
}

/** Drop empty entries and optionally remove formats for deleted rows. */
export function compactCellFormats(
  formats: TableCellFormats,
  validRowIds?: Set<string>,
): TableCellFormats {
  const out: TableCellFormats = {}
  for (const [key, fmt] of Object.entries(formats)) {
    if (isEmptyCellFormat(fmt)) continue
    if (validRowIds) {
      const rowId = key.split("::")[0]
      if (!validRowIds.has(rowId)) continue
    }
    out[key] = fmt
  }
  return out
}

export function pruneCellFormatsForRows(
  formats: TableCellFormats,
  rows: Pick<DueDiligenceTableRow, "id">[],
): TableCellFormats {
  return compactCellFormats(formats, new Set(rows.map((row) => row.id)))
}

export function cellFormatKey(rowId: string, colKey: string): string {
  return `${rowId}::${colKey}`
}

export function getCellFormat(
  formats: TableCellFormats,
  rowId: string,
  colKey: string,
): CellFormat {
  return formats[cellFormatKey(rowId, colKey)] ?? {}
}

export function patchCellFormat(
  formats: TableCellFormats,
  rowId: string,
  colKey: string,
  patch: Partial<CellFormat>,
): TableCellFormats {
  const key = cellFormatKey(rowId, colKey)
  return { ...formats, [key]: { ...(formats[key] ?? {}), ...patch } }
}

export function clearCellFormat(
  formats: TableCellFormats,
  rowId: string,
  colKey: string,
): TableCellFormats {
  const key = cellFormatKey(rowId, colKey)
  const next = { ...formats }
  delete next[key]
  return next
}

// ───────────────────────────────────────────────────────────────────────────

export function defaultDueDiligenceTableRowData(): DueDiligenceTableRowData {
  return {
    ddPersonnel: "",
    ddDate: "",
    ddTime: "",
    ddMethod: "",
    ddTarget: "",
    recommender: "",
    strategyPreliminary: "",
    fundCompany: "",
    investmentManager: "",
    representativeProduct: "",
    strategyLevel1: "",
    strategyLevel2: "",
    strategyLevel3: "",
    inTrackingPool: "",
    ddMaterials: "",
    otherInfo: "",
    ddConclusion: "",
  }
}

function rowFromSeed(seed: Record<string, string>): DueDiligenceTableRow {
  const now = new Date().toISOString()
  const data = defaultDueDiligenceTableRowData()
  for (const col of DD_TABLE_COLUMNS) {
    data[col.key] = String(seed[col.key] ?? "").trim()
  }
  return {
    ...data,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  }
}

export function seedDueDiligenceTableRows(): DueDiligenceTableRow[] {
  const base = Date.now()
  return (seedRows as Record<string, string>[]).map((seed, index) => {
    const row = rowFromSeed(seed)
    row.id = `seed-${index}-${row.id}`
    row.createdAt = new Date(base - (seedRows.length - index) * 60_000).toISOString()
    row.updatedAt = row.createdAt
    return row
  })
}

export function createDueDiligenceTableRow(
  data: Partial<DueDiligenceTableRowData> = {},
): DueDiligenceTableRow {
  const now = new Date().toISOString()
  return {
    ...defaultDueDiligenceTableRowData(),
    ...data,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateDueDiligenceTableRow(
  rows: DueDiligenceTableRow[],
  id: string,
  patch: DueDiligenceTableRowPatch,
): DueDiligenceTableRow[] {
  const now = new Date().toISOString()
  return rows.map((row) => {
    if (row.id !== id) return row
    const { representativeProductBeianHao, ...dataPatch } = patch
    const next: DueDiligenceTableRow = { ...row, ...dataPatch, updatedAt: now }
    if (representativeProductBeianHao === null || representativeProductBeianHao === "") {
      delete next.representativeProductBeianHao
    } else if (typeof representativeProductBeianHao === "string") {
      next.representativeProductBeianHao = representativeProductBeianHao
    }
    return next
  })
}

export function rowMatchesKeyword(row: DueDiligenceTableRow, keyword: string): boolean {
  const q = keyword.trim().toLowerCase()
  if (!q) return true
  return DD_TABLE_COLUMNS.some((col) =>
    String(row[col.key] ?? "").toLowerCase().includes(q),
  )
}

export function resetDueDiligenceTableFromSeed(): DueDiligenceTableRow[] {
  return seedDueDiligenceTableRows()
}

// ── Server persistence (PostgreSQL) ────────────────────────────────────────

export type DueDiligenceTableServerData = {
  rows: DueDiligenceTableRow[]
  formats: TableCellFormats
  updatedAt: string
  updatedBy: string
}

function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem("currentUser")
    if (!raw) return {}
    const user = JSON.parse(raw) as { id?: string; name?: string }
    const headers: Record<string, string> = {}
    if (user.id?.trim()) headers["x-market-user-id"] = user.id.trim()
    if (user.name?.trim()) headers["x-market-user-name"] = user.name.trim()
    return headers
  } catch {
    return {}
  }
}

async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || res.statusText || "请求失败")
  }
  return data as T
}

export async function loadDueDiligenceTableFromServer(): Promise<DueDiligenceTableServerData> {
  const data = await apiFetch<{
    ok: true
    rows: DueDiligenceTableRow[]
    formats: TableCellFormats
    updatedAt: string
    updatedBy: string
  }>("/ma/api/due-diligence-table")
  return {
    rows: data.rows,
    formats: data.formats ?? {},
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy,
  }
}

export async function saveDueDiligenceTableToServer(
  rows: DueDiligenceTableRow[],
  formats: TableCellFormats,
): Promise<DueDiligenceTableServerData> {
  const compactFormats = compactCellFormats(formats, new Set(rows.map((row) => row.id)))
  const data = await apiFetch<{
    ok: true
    rows: DueDiligenceTableRow[]
    formats: TableCellFormats
    updatedAt: string
    updatedBy: string
  }>("/ma/api/due-diligence-table", {
    method: "PUT",
    body: JSON.stringify({ rows, formats: compactFormats }),
  })
  return {
    rows: data.rows,
    formats: data.formats ?? {},
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy,
  }
}
