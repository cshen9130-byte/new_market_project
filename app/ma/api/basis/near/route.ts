import { NextResponse } from "next/server"
import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import { promisify } from "util"

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const mkdir = promisify(fs.mkdir)

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
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return formatYmd(d)
  }
  if (wd === 0) {
    const d = new Date(now)
    d.setDate(d.getDate() - 2)
    return formatYmd(d)
  }
  return formatYmd(now)
}

function ymdToIso(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

function parseExpiryFromTsCode(ts: string | undefined): { year: number; month: number } | null {
  if (!ts) return null
  // e.g., IF2606.CFX -> 26 06
  const m = ts.match(/^[A-Z]{2}(\d{4})/)
  if (!m) return null
  const yy = parseInt(m[1].slice(0, 2), 10)
  const mm = parseInt(m[1].slice(2, 4), 10)
  const year = 2000 + yy
  return { year, month: mm }
}

function thirdFriday(year: number, month: number): Date {
  const first = new Date(year, month - 1, 1)
  const firstDay = first.getDay()
  const firstFridayDate = 1 + ((5 - firstDay + 7) % 7)
  const thirdFridayDate = firstFridayDate + 14
  return new Date(year, month - 1, thirdFridayDate)
}
function nearestThirdFridayAfter(dateIso: string): Date {
  const d = new Date(dateIso)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  let cand = thirdFriday(y, m)
  if (cand.getTime() <= d.getTime()) {
    const nm = m === 12 ? 1 : m + 1
    const ny = m === 12 ? y + 1 : y
    cand = thirdFriday(ny, nm)
  }
  return cand
}

function daysBetween(aIso: string, bDate: Date): number {
  const a = new Date(aIso)
  const diffMs = bDate.getTime() - a.getTime()
  return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))
}

async function runPython(scriptPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<any> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(args[0], args.slice(1), { env })
      let stdout = ""
      let stderr = ""
      proc.stdout.on("data", (d) => (stdout += d.toString()))
      proc.stderr.on("data", (d) => (stderr += d.toString()))
      proc.on("error", (err) => resolve({ error: `spawn failed: ${err.message}` }))
      proc.on("close", (code) => {
        if (code !== 0) return resolve({ error: `python exited ${code}`, stderr, stdout })
        try {
          const text = (stdout || "").trim()
          let parsed: any
          try {
            parsed = JSON.parse(text)
          } catch (_e) {
            const first = text.indexOf("{")
            const last = text.lastIndexOf("}")
            if (first !== -1 && last !== -1 && last > first) parsed = JSON.parse(text.substring(first, last + 1))
            else throw _e
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
}

async function ensureCacheDir(cacheDir: string) {
  try {
    await mkdir(cacheDir, { recursive: true })
  } catch {}
}

async function readBasisCache(cachePath: string): Promise<{ entries: Record<string, any> }> {
  try {
    const buf = await readFile(cachePath, "utf-8")
    const obj = JSON.parse(buf)
    if (obj && typeof obj === "object" && obj.entries && typeof obj.entries === "object") {
      return obj
    }
  } catch {}
  return { entries: {} }
}

function latestDateKey(entries: Record<string, any>): string | null {
  const keys = Object.keys(entries)
  if (keys.length === 0) return null
  return keys.sort().at(-1) || null
}

function hasCompleteData(entry: any): boolean {
  if (!entry || !entry.data) return false
  if (!entry.calc || entry.calc !== "settle") return false
  const codes = ["IH", "IF", "IC", "IM"]
  for (const c of codes) {
    const v = entry.data?.[c]?.annualized_basis_pct
    if (typeof v !== "number") return false
  }
  return true
}

function latestCompleteEntry(entries: Record<string, any>): { key: string; entry: any } | null {
  const keys = Object.keys(entries).sort().reverse()
  for (const k of keys) {
    const e = entries[k]
    if (hasCompleteData(e)) return { key: k, entry: e }
  }
  return null
}

export async function GET(req: Request) {
  const json = (payload: any, status = 200) => NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } })
  const env = { ...process.env }
  const isWin = process.platform === "win32"
  let pythonExe = process.env.PYTHON_EXE
  const futScript = process.cwd() + "/scripts/ma/get_cffex_index_futures_latest.py"
  const spotScript = process.cwd() + "/scripts/ma/get_spot_indices_close.py"
  const cacheDir = path.join(process.cwd(), "data")
  const cachePath = path.join(cacheDir, "basis_near_cache.json")
  let debugFlag = false
  let forceRecompute = false
  let preferCache = false
  try {
    const url = new URL(req.url)
    debugFlag = url.searchParams.get("debug") === "1"
    forceRecompute = url.searchParams.get("force") === "1"
    preferCache = url.searchParams.get("prefer_cache") === "1" || url.searchParams.get("cacheOnly") === "1"
  } catch {}
  let runPyArgs: (script: string, extraEnv?: Record<string, string>) => string[]
  if (isWin && !pythonExe) {
    pythonExe = "py"
    runPyArgs = (script, _extra) => ["py", "-3", script]
  } else {
    pythonExe = pythonExe || "python"
    runPyArgs = (script, _extra) => [pythonExe as string, script]
  }

  const expectedYmd = expectedTradeDate()
  await ensureCacheDir(cacheDir)
  const cache = await readBasisCache(cachePath)
  const latestKey = latestDateKey(cache.entries)
  if (preferCache) {
    const latestComplete = latestCompleteEntry(cache.entries)
    if (latestComplete) return json(latestComplete.entry, 200)
  } else {
    if (!forceRecompute && latestKey && latestKey >= expectedYmd) {
      const entry = cache.entries[latestKey]
      if (hasCompleteData(entry)) {
        return json(entry, 200)
      }
    }
  }

  // Futures latest (for near-month settle)
  const futRes = await runPython(futScript, runPyArgs(futScript), { ...env, TUSHARE_TOKEN: process.env.TUSHARE_TOKEN })
  if (futRes?.error) {
    const latestComplete = latestCompleteEntry(cache.entries)
    if (latestComplete) return json(latestComplete.entry, 200)
    return json(futRes, 500)
  }
  const tradeDateYmd: string = futRes?.trade_date
  const tradeDateIso = ymdToIso(tradeDateYmd)

  // Spot closes for trade date via EmQuant
  let spotRes = await runPython(spotScript, runPyArgs(spotScript), {
    ...env,
    EMQ_USERNAME: process.env.EMQ_USERNAME || "",
    EMQ_PASSWORD: process.env.EMQ_PASSWORD || "",
    EMQ_OPTIONS_EXTRA: process.env.EMQ_OPTIONS_EXTRA || "",
    SPOT_TRADE_DATE: tradeDateIso,
  })
  if (spotRes?.error || !spotRes?.data || Object.keys(spotRes.data).length === 0) {
    const tsSpotScript = process.cwd() + "/scripts/ma/get_spot_indices_close_tushare.py"
    const tsRes = await runPython(tsSpotScript, runPyArgs(tsSpotScript), {
      ...env,
      TUSHARE_TOKEN: process.env.TUSHARE_TOKEN || "",
      SPOT_TRADE_DATE: tradeDateIso,
    })
    if (tsRes?.error) {
      const latestComplete2 = latestCompleteEntry(cache.entries)
      if (latestComplete2) return json(latestComplete2.entry, 200)
      return json(tsRes, 500)
    }
    spotRes = tsRes
  }

  const codes = ["IH", "IF", "IC", "IM"]
  const out: any = {}
  const debugInputs: any = {}
  for (const code of codes) {
    const f = futRes?.data?.[code]
    const s = spotRes?.data?.[code]
    const nearTs: string | undefined = f?.near_ts_code || undefined
    const nearSettle: number | undefined = typeof f?.near_settle === "number" ? f.near_settle : undefined
    const spotClose: number | undefined = typeof s?.close === "number" ? s.close : undefined
    let annualizedPct: number | null = null
    let daysToMat: number | null = null
    let expiryStr: string | null = null
    if (typeof nearSettle === "number" && typeof spotClose === "number") {
      const exp = parseExpiryFromTsCode(nearTs)
      let expiry: Date | null = null
      if (exp) {
        expiry = thirdFriday(exp.year, exp.month)
      } else {
        // Continuous near-month like IHL.CFX -> use nearest upcoming third Friday
        expiry = nearestThirdFridayAfter(tradeDateIso)
      }
      if (expiry) {
        daysToMat = daysBetween(tradeDateIso, expiry)
        try { expiryStr = expiry.toISOString().slice(0, 10) } catch {}
        const basis = (nearSettle - spotClose) / spotClose
        annualizedPct = basis * (365 / (daysToMat || 1)) * 100
      }
    }
    const dbg = {
      trade_date: tradeDateIso,
      near_settle: nearSettle ?? null,
      spot_close: spotClose ?? null,
      days_to_maturity: daysToMat ?? null,
      expiry: expiryStr,
    }
    debugInputs[code] = dbg
    out[code] = {
      trade_date: tradeDateYmd,
      near_ts_code: nearTs || null,
      near_settle: nearSettle ?? null,
      spot_close: spotClose ?? null,
      days_to_maturity: daysToMat,
      annualized_basis_pct: annualizedPct,
    }
  }
  const entryBase = { trade_date: tradeDateYmd, data: out, calc: "settle" }
  const entry = debugFlag ? { ...entryBase, debug_inputs: debugInputs } : entryBase
  try {
    cache.entries[tradeDateYmd] = entry
    await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf-8")
  } catch (e) {
    console.warn("[basis-near] failed to write cache:", (e as any)?.message)
  }
  // If today's computed entry is incomplete, fall back to latest complete cached entry
  if (!hasCompleteData(entry)) {
    const latestComplete = latestCompleteEntry(cache.entries)
    if (latestComplete) {
      const stale = { ...latestComplete.entry, stale_from: latestComplete.key }
      return json(stale, 200)
    }
  }
  return json(entry, 200)
}
