import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Column header → expected position (0-indexed) mapping from the TA export
const COL = {
  product_code: 0,       // 产品代码
  product_name: 1,       // 产品名称
  customer_name: 2,      // 客户名称
  transaction_type: 3,   // 业务类型
  application_date: 4,   // 申请日期
  confirmation_date: 5,  // 确认日期
  confirmed_amount: 6,   // 确认金额
  confirmed_net_amount: 7, // 确认净额
  confirmed_shares: 8,   // 确认份额
  confirmation_result: 9, // 确认结果
  unit_nav: 10,           // 单位净值
  cumulative_nav: 11,     // 累计净值
  handling_fee: 12,       // 手续费
  performance_fee: 13,    // 业绩报酬
  total_confirmed_amount: 14, // 确认总金额（含费）
  application_amount: 15, // 申请金额
  application_shares: 16, // 申请份额
  remaining_shares: 17,   // 剩余份额
  sales_org_name: 18,     // 销售机构名称
  ta_clearing_time: 19,   // TA清算确认时间
}

/** Parse a yyyymmdd string like "20250618" to ISO date "2025-06-18" */
function parseDateStr(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

/** Parse a number-like value (may contain commas like "1,000,000.00") */
function parseNum(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === "number") return isFinite(v) ? v : null
  const s = String(v).replace(/,/g, "").trim()
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

/** Parse a timestamp string like "2025-06-18 06:56:53" */
function parseTs(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  // "YYYY-MM-DD HH:MM:SS"
  const d = new Date(s.replace(" ", "T") + (s.includes("+") ? "" : "+08:00"))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

interface TxRow {
  product_code: string
  product_name: string
  customer_name: string
  transaction_type: string
  application_date: string | null
  confirmation_date: string | null
  confirmed_amount: number | null
  confirmed_net_amount: number | null
  confirmed_shares: number | null
  confirmation_result: string | null
  unit_nav: number | null
  cumulative_nav: number | null
  handling_fee: number | null
  performance_fee: number | null
  total_confirmed_amount: number | null
  application_amount: number | null
  application_shares: number | null
  remaining_shares: number | null
  sales_org_name: string | null
  ta_clearing_time: string | null
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

    // Parse xlsx using SheetJS
    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false })

    if (workbook.SheetNames.length === 0) {
      return NextResponse.json({ error: "文件中没有工作表" }, { status: 400 })
    }

    const sheetName = workbook.SheetNames[0]
    const ws = workbook.Sheets[sheetName]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

    if (rows.length < 2) {
      return NextResponse.json({ error: "文件数据为空" }, { status: 400 })
    }

    // Validate header row
    const header = rows[0] as unknown[]
    if (String(header[0]).trim() !== "产品代码") {
      return NextResponse.json(
        { error: "文件格式不匹配：第一列应为\u300c产品代码\u300d，请确认上传了正确的历史交易确认明细文件。" },
        { status: 400 },
      )
    }

    // Parse data rows — skip rows where product_code is null (subtotal/summary rows)
    const valid: TxRow[] = []
    const skipped: number[] = []

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[]
      const productCode = row[COL.product_code]
      const txType = row[COL.transaction_type]

      // Skip subtotal/summary/formula rows
      if (productCode == null || String(productCode).trim() === "") {
        skipped.push(i + 1)
        continue
      }
      // Skip rows without a business type
      if (txType == null || String(txType).trim() === "") {
        skipped.push(i + 1)
        continue
      }

      valid.push({
        product_code: String(productCode).trim(),
        product_name: row[COL.product_name] != null ? String(row[COL.product_name]).trim() : "",
        customer_name: row[COL.customer_name] != null ? String(row[COL.customer_name]).trim() : "",
        transaction_type: String(txType).trim(),
        application_date: parseDateStr(row[COL.application_date]),
        confirmation_date: parseDateStr(row[COL.confirmation_date]),
        confirmed_amount: parseNum(row[COL.confirmed_amount]),
        confirmed_net_amount: parseNum(row[COL.confirmed_net_amount]),
        confirmed_shares: parseNum(row[COL.confirmed_shares]),
        confirmation_result: row[COL.confirmation_result] != null ? String(row[COL.confirmation_result]).trim() : null,
        unit_nav: parseNum(row[COL.unit_nav]),
        cumulative_nav: parseNum(row[COL.cumulative_nav]),
        handling_fee: parseNum(row[COL.handling_fee]),
        performance_fee: parseNum(row[COL.performance_fee]),
        total_confirmed_amount: parseNum(row[COL.total_confirmed_amount]),
        application_amount: parseNum(row[COL.application_amount]),
        application_shares: parseNum(row[COL.application_shares]),
        remaining_shares: parseNum(row[COL.remaining_shares]),
        sales_org_name: row[COL.sales_org_name] != null ? String(row[COL.sales_org_name]).trim() : null,
        ta_clearing_time: parseTs(row[COL.ta_clearing_time]),
      })
    }

    if (valid.length === 0) {
      return NextResponse.json({ error: "文件中没有有效的交易记录" }, { status: 400 })
    }

    // Ensure table exists (idempotent DDL)
    await query(`
      CREATE TABLE IF NOT EXISTS mom_fund_transactions (
        id                      SERIAL PRIMARY KEY,
        product_code            VARCHAR(20)     NOT NULL,
        product_name            VARCHAR(200)    NOT NULL,
        customer_name           VARCHAR(200)    NOT NULL,
        transaction_type        VARCHAR(20)     NOT NULL,
        application_date        DATE,
        confirmation_date       DATE,
        confirmed_amount        NUMERIC(20, 2),
        confirmed_net_amount    NUMERIC(20, 2),
        confirmed_shares        NUMERIC(20, 6),
        confirmation_result     VARCHAR(20),
        unit_nav                NUMERIC(12, 6),
        cumulative_nav          NUMERIC(12, 6),
        handling_fee            NUMERIC(20, 2),
        performance_fee         NUMERIC(20, 2),
        total_confirmed_amount  NUMERIC(20, 2),
        application_amount      NUMERIC(20, 2),
        application_shares      NUMERIC(20, 6),
        remaining_shares        NUMERIC(20, 6),
        sales_org_name          VARCHAR(200),
        ta_clearing_time        TIMESTAMPTZ,
        imported_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      )
    `)

    // Replace strategy: truncate then re-insert. The file is always a full history export.
    await query("TRUNCATE TABLE mom_fund_transactions")

    // Batch insert in chunks of 50
    const CHUNK = 50
    let inserted = 0
    for (let start = 0; start < valid.length; start += CHUNK) {
      const chunk = valid.slice(start, start + CHUNK)
      const placeholders: string[] = []
      const values: unknown[] = []
      let p = 1
      for (const r of chunk) {
        placeholders.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
        )
        values.push(
          r.product_code, r.product_name, r.customer_name, r.transaction_type,
          r.application_date, r.confirmation_date,
          r.confirmed_amount, r.confirmed_net_amount, r.confirmed_shares,
          r.confirmation_result, r.unit_nav, r.cumulative_nav,
          r.handling_fee, r.performance_fee, r.total_confirmed_amount,
          r.application_amount, r.application_shares, r.remaining_shares,
          r.sales_org_name, r.ta_clearing_time,
        )
      }
      await query(
        `INSERT INTO mom_fund_transactions (
          product_code, product_name, customer_name, transaction_type,
          application_date, confirmation_date,
          confirmed_amount, confirmed_net_amount, confirmed_shares,
          confirmation_result, unit_nav, cumulative_nav,
          handling_fee, performance_fee, total_confirmed_amount,
          application_amount, application_shares, remaining_shares,
          sales_org_name, ta_clearing_time
        ) VALUES ${placeholders.join(",")}`,
        values,
      )
      inserted += chunk.length
    }

    return NextResponse.json({
      success: true,
      inserted,
      skipped: skipped.length,
      message: `成功导入 ${inserted} 条记录（跳过 ${skipped.length} 行合计/空行）`,
    })
  } catch (e) {
    console.error("[capital-flow/import]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "导入失败" },
      { status: 500 },
    )
  }
}
