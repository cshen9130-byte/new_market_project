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

const STORAGE_KEY = "dd_diligence_table_rows"
const FORMATS_STORAGE_KEY = "dd_diligence_table_formats"

export function loadCellFormats(): TableCellFormats {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(FORMATS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as TableCellFormats) ?? {} : {}
  } catch { return {} }
}

export function saveCellFormats(formats: TableCellFormats): void {
  if (typeof window === "undefined") return
  localStorage.setItem(FORMATS_STORAGE_KEY, JSON.stringify(formats))
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

function seedDueDiligenceTableRows(): DueDiligenceTableRow[] {
  const base = Date.now()
  return (seedRows as Record<string, string>[]).map((seed, index) => {
    const row = rowFromSeed(seed)
    row.id = `seed-${index}-${row.id}`
    row.createdAt = new Date(base - (seedRows.length - index) * 60_000).toISOString()
    row.updatedAt = row.createdAt
    return row
  })
}

export function loadDueDiligenceTableRows(): DueDiligenceTableRow[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // Only use stored data if it has actual rows
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
    // Nothing in storage (or empty array) → seed from the Excel import
    const seeded = seedDueDiligenceTableRows()
    saveDueDiligenceTableRows(seeded)
    return seeded
  } catch {
    const seeded = seedDueDiligenceTableRows()
    saveDueDiligenceTableRows(seeded)
    return seeded
  }
}

export function saveDueDiligenceTableRows(rows: DueDiligenceTableRow[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
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
  patch: Partial<DueDiligenceTableRowData>,
): DueDiligenceTableRow[] {
  const now = new Date().toISOString()
  return rows.map((row) =>
    row.id === id ? { ...row, ...patch, updatedAt: now } : row,
  )
}

export function rowMatchesKeyword(row: DueDiligenceTableRow, keyword: string): boolean {
  const q = keyword.trim().toLowerCase()
  if (!q) return true
  return DD_TABLE_COLUMNS.some((col) => row[col.key].toLowerCase().includes(q))
}

export function resetDueDiligenceTableFromSeed(): DueDiligenceTableRow[] {
  const seeded = seedDueDiligenceTableRows()
  saveDueDiligenceTableRows(seeded)
  return seeded
}
