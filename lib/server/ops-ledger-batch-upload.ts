import * as XLSX from "xlsx"

export interface OpsLedgerBatchRow {
  fof_fund_name: string
  fof_register_number: string
  underlying_fund_name: string
  underlying_beian_hao: string
  transaction_type: string
  apply_date: string
  confirm_date: string
  confirmed_amount: string | null
  confirmed_shares: string | null
  confirmed_unit_nav: string | null
  transaction_fee: string | null
  performance_fee: string | null
  dividend_per_unit: string | null
  remark: string | null
}

const HEADER_ALIASES: Record<keyof OpsLedgerBatchRow, string[]> = {
  fof_fund_name: ["FOF基金名称"],
  fof_register_number: ["FOF基金备案号"],
  underlying_fund_name: ["底层基金名称"],
  underlying_beian_hao: ["底层备案号", "底层基金备案号"],
  transaction_type: ["交易类型"],
  apply_date: ["申请日期"],
  confirm_date: ["确认日期"],
  confirmed_amount: ["确认净额", "确认金额"],
  confirmed_shares: ["确认份额"],
  confirmed_unit_nav: ["确认单位净值"],
  transaction_fee: ["交易费用"],
  performance_fee: ["业绩报酬"],
  dividend_per_unit: ["每单位分红"],
  remark: ["备注"],
}

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function formatDateValue(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
  }
  const s = String(v ?? "").trim()
  if (!s || /如：|说明：|必填/.test(s)) return ""
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
  return s
}

function cellStr(v: unknown): string {
  if (v == null) return ""
  if (v instanceof Date) return formatDateValue(v)
  return String(v).trim()
}

function nullableCell(v: unknown): string | null {
  const s = cellStr(v)
  if (!s || /如：|说明：/.test(s)) return null
  return s
}

function isExampleOrEmptyRow(values: Partial<OpsLedgerBatchRow>): boolean {
  const fofReg = values.fof_register_number ?? ""
  const underlyingReg = values.underlying_beian_hao ?? ""
  const joined = Object.values(values).filter(Boolean).join("")
  if (/如：|说明：|必填/.test(joined)) return true
  if (!fofReg && !underlyingReg) return true
  return false
}

function resolveColumnIndexes(header: unknown[]): Partial<Record<keyof OpsLedgerBatchRow, number>> {
  const indexes: Partial<Record<keyof OpsLedgerBatchRow, number>> = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [keyof OpsLedgerBatchRow, string[]][]) {
    const idx = header.findIndex((cell) => aliases.includes(cellStr(cell)))
    if (idx >= 0) indexes[key] = idx
  }
  return indexes
}

function readRow(row: unknown[], indexes: Partial<Record<keyof OpsLedgerBatchRow, number>>): Partial<OpsLedgerBatchRow> {
  const get = (key: keyof OpsLedgerBatchRow) => {
    const idx = indexes[key]
    return idx == null ? "" : row[idx]
  }
  return {
    fof_fund_name: cellStr(get("fof_fund_name")),
    fof_register_number: cellStr(get("fof_register_number")),
    underlying_fund_name: cellStr(get("underlying_fund_name")),
    underlying_beian_hao: cellStr(get("underlying_beian_hao")),
    transaction_type: cellStr(get("transaction_type")),
    apply_date: formatDateValue(get("apply_date")),
    confirm_date: formatDateValue(get("confirm_date")),
    confirmed_amount: nullableCell(get("confirmed_amount")),
    confirmed_shares: nullableCell(get("confirmed_shares")),
    confirmed_unit_nav: nullableCell(get("confirmed_unit_nav")),
    transaction_fee: nullableCell(get("transaction_fee")),
    performance_fee: nullableCell(get("performance_fee")),
    dividend_per_unit: nullableCell(get("dividend_per_unit")),
    remark: nullableCell(get("remark")),
  }
}

export function parseLedgerBatchSheetRows(rows: unknown[][]): OpsLedgerBatchRow[] {
  if (rows.length === 0) return []

  const headerIdx = rows.findIndex((row) =>
    row.some((cell) => cellStr(cell) === "FOF基金备案号"),
  )
  if (headerIdx < 0) return []

  const indexes = resolveColumnIndexes(rows[headerIdx] ?? [])
  if (indexes.fof_register_number == null || indexes.underlying_beian_hao == null) return []

  const parsed: OpsLedgerBatchRow[] = []
  for (const row of rows.slice(headerIdx + 1)) {
    if (!Array.isArray(row)) continue
    const values = readRow(row, indexes)
    if (isExampleOrEmptyRow(values)) continue
    parsed.push({
      fof_fund_name: values.fof_fund_name ?? "",
      fof_register_number: values.fof_register_number ?? "",
      underlying_fund_name: values.underlying_fund_name ?? "",
      underlying_beian_hao: values.underlying_beian_hao ?? "",
      transaction_type: values.transaction_type ?? "",
      apply_date: values.apply_date ?? "",
      confirm_date: values.confirm_date ?? "",
      confirmed_amount: values.confirmed_amount ?? null,
      confirmed_shares: values.confirmed_shares ?? null,
      confirmed_unit_nav: values.confirmed_unit_nav ?? null,
      transaction_fee: values.transaction_fee ?? null,
      performance_fee: values.performance_fee ?? null,
      dividend_per_unit: values.dividend_per_unit ?? null,
      remark: values.remark ?? null,
    })
  }
  return parsed
}

export function parseLedgerBatchUploadBuffer(buffer: Buffer, filename: string): OpsLedgerBatchRow[] {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "csv") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "")
    const rows = text.split(/\r?\n/).map((line) => line.split(","))
    return parseLedgerBatchSheetRows(rows)
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" })
  return parseLedgerBatchSheetRows(rows)
}
