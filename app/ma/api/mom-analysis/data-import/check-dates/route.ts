import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

import cnStatutoryHolidayDates from "@/lib/cn-statutory-holiday-dates.json"
import { isoDateWeekdayUtc } from "@/lib/nav-trading-day"

/**
 * State Council 放假调休, same file as the China trading calendar.
 * Weekends are closed. 补班 weekends stay closed: futures exchanges do not open them.
 * Do not use `date-holidays` here — it marks 六一儿童节 as public, and the market is open.
 */
const MARKET_CLOSED = new Set<string>(cnStatutoryHolidayDates)

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_DIR = process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")

// Start scanning from this date (inclusive)
const SCAN_FROM = "20250704"

function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function isFuturesTradingDay(iso: string): boolean {
  if (MARKET_CLOSED.has(iso)) return false
  const weekday = isoDateWeekdayUtc(iso)
  return weekday != null && weekday !== 0 && weekday !== 6
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
      const iso = toIso(cur)
      if (isFuturesTradingDay(iso)) {
        const ymd = iso.replace(/-/g, "")
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
