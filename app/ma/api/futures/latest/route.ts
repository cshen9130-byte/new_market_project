import { NextResponse } from "next/server"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function formatYmd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  return `${y}${m}${da}`
}

function expectedTradeDate(): string {
  const now = new Date()
  const wd = now.getDay() // 0=Sun,6=Sat
  if (wd === 6) {
    // Saturday -> Friday
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return formatYmd(d)
  }
  if (wd === 0) {
    // Sunday -> Friday
    const d = new Date(now)
    d.setDate(d.getDate() - 2)
    return formatYmd(d)
  }
  return formatYmd(now)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const force = url.searchParams.get("force") === "1"
  const env = {
    ...process.env,
    TUSHARE_TOKEN: process.env.TUSHARE_TOKEN,
  }

  const scriptPath = process.cwd() + "/scripts/ma/get_cffex_index_futures_latest.py"
  const isWin = process.platform === "win32"
  let pythonExe = process.env.PYTHON_EXE
  let args: string[] = []
  if (isWin && !pythonExe) {
    pythonExe = "py"
    args = ["-3", scriptPath]
  } else {
    pythonExe = pythonExe || "python"
    if ((pythonExe || "").toLowerCase() === "py") {
      args = ["-3", scriptPath]
    } else {
      args = [scriptPath]
    }
  }

  // First, try returning cached data from local filesystem
  const expected = expectedTradeDate()
  const cacheDir = process.env.FUTURES_CACHE_DIR || path.join(process.cwd(), "data")
  const cacheFile = path.join(cacheDir, "futures_cache.json")
  try {
    if (!force) {
      const txt = await fs.readFile(cacheFile, "utf-8")
      const json = JSON.parse(txt)
      const dayData = json?.[expected]
      const codes = ["IH", "IF", "IC", "IM"]
      if (dayData && codes.every((c) => dayData[c])) {
        // If cached data lacks new near/far fields, treat as stale and recompute
        const hasNear = codes.every((c) => dayData[c]?.near_settle != null || dayData[c]?.near_close != null)
        const hasFar = codes.every((c) => dayData[c]?.far_settle != null || dayData[c]?.far_close != null)
        if (hasNear && hasFar) {
          return NextResponse.json({ exchange: "CFFEX", trade_date: expected, data: dayData })
        }
      }
    }
  } catch {}

  // Otherwise, call Python script once and upsert results to DB
  const result: any = await new Promise((resolve) => {
    try {
      const proc = spawn(pythonExe as string, args, { env })
      let stdout = ""
      let stderr = ""
      proc.stdout.on("data", (d) => (stdout += d.toString()))
      proc.stderr.on("data", (d) => (stderr += d.toString()))
      proc.on("error", (err) => {
        resolve({ error: `spawn failed: ${err.message}` })
      })
      proc.on("close", (code) => {
        if (code !== 0) {
          resolve({ error: `python exited with code ${code}`, stderr, stdout })
          return
        }
        try {
          const text = (stdout || "").trim()
          let parsed: any
          try {
            parsed = JSON.parse(text)
          } catch (_e) {
            const first = text.indexOf("{")
            const last = text.lastIndexOf("}")
            if (first !== -1 && last !== -1 && last > first) {
              const candidate = text.substring(first, last + 1)
              parsed = JSON.parse(candidate)
            } else {
              throw _e
            }
          }
          resolve(parsed)
        } catch (e: any) {
          resolve({ error: `json parse failed: ${e?.message}`, stdout, stderr })
        }
      })
    } catch (e: any) {
      resolve({ error: e?.message || "unknown" })
    }
  })

  if (result?.error) {
    return NextResponse.json(result, { status: 500 })
  }

  // Write result to local cache file
  try {
    await fs.mkdir(cacheDir, { recursive: true })
    let existing: any = {}
    try {
      const txt = await fs.readFile(cacheFile, "utf-8")
      existing = JSON.parse(txt)
    } catch {}
    existing[result.trade_date] = result.data || {}
    await fs.writeFile(cacheFile, JSON.stringify(existing), "utf-8")
  } catch {}

  return NextResponse.json(result, { status: 200 })
}
