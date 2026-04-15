import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXPECTED_HEADERS = [
  "板块",
  "投顾",
  "账号",
  "权益（万元）",
  "预警/止损",
  "背景",
  "风格",
  "周期",
  "是否套利",
  "主要优势",
  "地区",
  "公司",
  "品种偏好",
  "规模变动",
] as const

function parseText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const normalized = String(value).replace(/,/g, "").trim()
  if (!normalized) return null
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseBoolean(value: unknown): boolean | null {
  const text = parseText(value)
  if (!text) return null
  if (text === "是") return true
  if (text === "否") return false
  return null
}

function parseLooseDate(value: unknown): string | null {
  const text = parseText(value)
  if (!text) return null
  const normalized = text.replace(/[.]/g, "/")
  const match = normalized.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/)
  if (!match) return null
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

function parseScaleChange(value: unknown) {
  const raw = parseText(value)
  if (!raw) {
    return {
      raw: null,
      amount: null,
      effectiveDate: null,
    }
  }

  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean)
  return {
    raw,
    amount: parts.length > 0 ? parseNumber(parts[0]) : null,
    effectiveDate: parts.length > 1 ? parseLooseDate(parts[1]) : null,
  }
}

interface AdvisorRow {
  sheet_name: string
  row_number: number
  sector: string | null
  advisor_name: string
  account_code: string
  equity_wan: number | null
  warning_stop_loss: string | null
  background: string | null
  style: string | null
  cycle: string | null
  is_arbitrage: boolean | null
  main_strength: string | null
  region: string | null
  company: string | null
  product_preference: string | null
  scale_change_raw: string | null
  scale_change_amount: number | null
  scale_change_effective_date: string | null
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传一个 .xlsx 文件" }, { status: 400 })
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "仅支持 .xlsx 格式" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false })
    if (workbook.SheetNames.length === 0) {
      return NextResponse.json({ error: "文件中没有工作表" }, { status: 400 })
    }

    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })

    if (rows.length < 2) {
      return NextResponse.json({ error: "文件数据为空" }, { status: 400 })
    }

    const header = rows[0].slice(0, EXPECTED_HEADERS.length).map((cell) => parseText(cell) ?? "")
    const mismatches = EXPECTED_HEADERS.filter((name, index) => header[index] !== name)
    if (mismatches.length > 0) {
      return NextResponse.json(
        { error: `文件格式不匹配：表头应为 ${EXPECTED_HEADERS.join(" / ")}` },
        { status: 400 },
      )
    }

    const parsedRows: AdvisorRow[] = []
    const skippedRows: number[] = []
    let currentSector: string | null = null

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] ?? []
      const sector = parseText(row[0])
      if (sector) currentSector = sector

      const advisorName = parseText(row[1])
      const accountCode = parseText(row[2])
      if (!advisorName && !accountCode) {
        skippedRows.push(rowIndex + 1)
        continue
      }
      if (!advisorName || !accountCode) {
        skippedRows.push(rowIndex + 1)
        continue
      }

      const scaleChange = parseScaleChange(row[13])
      parsedRows.push({
        sheet_name: sheetName,
        row_number: rowIndex + 1,
        sector: currentSector,
        advisor_name: advisorName,
        account_code: accountCode,
        equity_wan: parseNumber(row[3]),
        warning_stop_loss: parseText(row[4]),
        background: parseText(row[5]),
        style: parseText(row[6]),
        cycle: parseText(row[7]),
        is_arbitrage: parseBoolean(row[8]),
        main_strength: parseText(row[9]),
        region: parseText(row[10]),
        company: parseText(row[11]),
        product_preference: parseText(row[12]),
        scale_change_raw: scaleChange.raw,
        scale_change_amount: scaleChange.amount,
        scale_change_effective_date: scaleChange.effectiveDate,
      })
    }

    if (parsedRows.length === 0) {
      return NextResponse.json({ error: "文件中没有可导入的有效记录" }, { status: 400 })
    }

    await query(`
      CREATE TABLE IF NOT EXISTS mom_advisor_info (
        id                           SERIAL PRIMARY KEY,
        sheet_name                   VARCHAR(100)    NOT NULL,
        row_number                   INTEGER         NOT NULL,
        sector                       VARCHAR(100),
        advisor_name                 VARCHAR(100)    NOT NULL,
        account_code                 VARCHAR(50)     NOT NULL,
        equity_wan                   NUMERIC(20, 2),
        warning_stop_loss            VARCHAR(100),
        background                   VARCHAR(100),
        style                        VARCHAR(255),
        cycle                        VARCHAR(100),
        is_arbitrage                 BOOLEAN,
        main_strength                VARCHAR(255),
        region                       VARCHAR(100),
        company                      VARCHAR(255),
        product_preference           VARCHAR(255),
        scale_change_raw             VARCHAR(100),
        scale_change_amount          NUMERIC(20, 2),
        scale_change_effective_date  DATE,
        imported_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      )
    `)
    await query("TRUNCATE TABLE mom_advisor_info")

    const CHUNK_SIZE = 100
    let inserted = 0
    for (let start = 0; start < parsedRows.length; start += CHUNK_SIZE) {
      const chunk = parsedRows.slice(start, start + CHUNK_SIZE)
      const placeholders: string[] = []
      const values: unknown[] = []
      let parameterIndex = 1

      for (const row of chunk) {
        placeholders.push(
          `($${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++},$${parameterIndex++})`,
        )
        values.push(
          row.sheet_name,
          row.row_number,
          row.sector,
          row.advisor_name,
          row.account_code,
          row.equity_wan,
          row.warning_stop_loss,
          row.background,
          row.style,
          row.cycle,
          row.is_arbitrage,
          row.main_strength,
          row.region,
          row.company,
          row.product_preference,
          row.scale_change_raw,
          row.scale_change_amount,
          row.scale_change_effective_date,
        )
      }

      await query(
        `INSERT INTO mom_advisor_info (
          sheet_name,
          row_number,
          sector,
          advisor_name,
          account_code,
          equity_wan,
          warning_stop_loss,
          background,
          style,
          cycle,
          is_arbitrage,
          main_strength,
          region,
          company,
          product_preference,
          scale_change_raw,
          scale_change_amount,
          scale_change_effective_date
        ) VALUES ${placeholders.join(",")}`,
        values,
      )
      inserted += chunk.length
    }

    return NextResponse.json({
      success: true,
      inserted,
      skipped: skippedRows.length,
      sheetName,
      message: `成功导入 ${inserted} 条投顾记录（跳过 ${skippedRows.length} 行空白/不完整记录）`,
    })
  } catch (error) {
    console.error("[advisor-info/import]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入失败" },
      { status: 500 },
    )
  }
}