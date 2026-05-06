import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_DIR = process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")

// Start scanning from this date (inclusive)
const SCAN_FROM = "20250704"

// Weekdays that are NOT trading days (Chinese A-share market holidays, excluding weekends)
const MARKET_HOLIDAYS = new Set([
  // 国庆节 + 中秋节 2025
  "20251001", "20251002", "20251003",
  "20251006", "20251007", "20251008",
  // 元旦 2026 (Jan 1–2)
  "20260101", "20260102",
  // 春节 2026 (Feb 11–13, 16–20, 23)
  "20260211", "20260212", "20260213",
  "20260216", "20260217", "20260218",
  "20260219", "20260220", "20260223",
  // 清明节 2026 (Apr 6, Mon — Qingming falls on Sun Apr 5, observed Mon)
  "20260406",
  // 劳动节 2026 (May 1 Fri + May 4–5 Mon–Tue)
  "20260501", "20260504", "20260505",
])

// 补班 trading days (currently none in the scan range)
const MAKEUP_TRADING_DAYS = new Set<string>([])

function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}${m}${day}`
}

function isTradingDay(d: Date): boolean {
  const ymd = toYMD(d)
  if (MAKEUP_TRADING_DAYS.has(ymd)) return true
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return false
  if (MARKET_HOLIDAYS.has(ymd)) return false
  return true
}

export async function GET(): Promise<Response> {
  try {
    // Collect date strings embedded in folder names (8-digit YYYYMMDD)
    const existingDates = new Set<string>()
    if (fs.existsSync(BASE_DIR)) {
      for (const entry of fs.readdirSync(BASE_DIR)) {
        if (!fs.statSync(path.join(BASE_DIR, entry)).isDirectory()) continue
        const m = /(\d{8})/.exec(entry)
        if (m) existingDates.add(m[1])
      }
    }

    // Generate expected trading dates from SCAN_FROM up to and including today
    const startY = parseInt(SCAN_FROM.slice(0, 4), 10)
    const startM = parseInt(SCAN_FROM.slice(4, 6), 10) - 1
    const startD = parseInt(SCAN_FROM.slice(6, 8), 10)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const cur = new Date(startY, startM, startD)
    const expectedDates: string[] = []
    const missingDates: string[] = []

    while (cur <= today) {
      if (isTradingDay(cur)) {
        const ymd = toYMD(cur)
        expectedDates.push(ymd)
        if (!existingDates.has(ymd)) missingDates.push(ymd)
      }
      cur.setDate(cur.getDate() + 1)
    }

    return NextResponse.json({
      scanFrom: SCAN_FROM,
      totalExpected: expectedDates.length,
      totalExisting: existingDates.size,
      missingDates,
      missingCount: missingDates.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "检查失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
