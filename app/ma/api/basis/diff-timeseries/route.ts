import { NextResponse } from "next/server"
import { spawn } from "child_process"
import fs from "fs"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function formatYmd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  return `${y}${m}${da}`
}
function ymdToIso(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}
function expectedTradeDate(): string {
  const now = new Date()
  const wd = now.getDay()
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

async function runPython(args: string[], env: NodeJS.ProcessEnv): Promise<any> {
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

export async function GET(req: Request) {
  const env = { ...process.env }
  const isWin = process.platform === "win32"
  let pythonExe = process.env.PYTHON_EXE
  const futScript = path.join(process.cwd(), "scripts/ma/get_cffex_index_futures_range.py")
  const spotScript = path.join(process.cwd(), "scripts/ma/get_spot_indices_timeseries.py")
  const cacheDir = path.join(process.cwd(), "data")
  const cachePath = path.join(cacheDir, "basis_diff_timeseries_cache.json")
  const expectedYmd = expectedTradeDate()
  let debugFlag = false
  let forceRecompute = false
  let preferCache = false
  try {
    const url = new URL(req.url)
    debugFlag = url.searchParams.get("debug") === "1"
    forceRecompute = url.searchParams.get("force") === "1"
    preferCache = url.searchParams.get("prefer_cache") === "1" || url.searchParams.get("cacheOnly") === "1"
  } catch {}

  const runArgs = (script: string, arg1?: string, arg2?: string) => {
    if (isWin && !pythonExe) {
      return ["py", "-3", script, ...(arg1 ? [arg1] : []), ...(arg2 ? [arg2] : [])]
    }
    const exe = pythonExe || "python"
    return [exe as string, script, ...(arg1 ? [arg1] : []), ...(arg2 ? [arg2] : [])]
  }

  // Cache-first: if preferCache, return any cache; otherwise require freshness
  try {
    await fs.promises.mkdir(cacheDir, { recursive: true })
    const buf = await fs.promises.readFile(cachePath, "utf-8").catch(() => "")
    if (buf) {
      const obj = JSON.parse(buf)
      const end: string | undefined = obj?.end_date || obj?.end
      if (preferCache && obj?.data) {
        return NextResponse.json(obj, { status: 200 })
      }
      if (!forceRecompute) {
        if (end && end >= expectedYmd && obj?.data) {
          return NextResponse.json(obj, { status: 200 })
        }
      }
    }
  } catch {}

  const startYmd = "20230101"
  const endYmd = expectedYmd
  const startIso = ymdToIso(startYmd)
  const endIso = ymdToIso(endYmd)

  const futRes = await runPython(runArgs(futScript, startYmd, endYmd), { ...env, TUSHARE_TOKEN: process.env.TUSHARE_TOKEN || "" })
  if (futRes?.error) {
    try {
      const buf = await fs.promises.readFile(cachePath, "utf-8").catch(() => "")
      if (buf) {
        const obj = JSON.parse(buf)
        if (obj?.data) return NextResponse.json(obj, { status: 200 })
      }
    } catch {}
    return NextResponse.json(futRes, { status: 500 })
  }
  const spotRes = await runPython(runArgs(spotScript, startIso, endIso), {
    ...env,
    EMQ_USERNAME: process.env.EMQ_USERNAME || "",
    EMQ_PASSWORD: process.env.EMQ_PASSWORD || "",
    EMQ_OPTIONS_EXTRA: process.env.EMQ_OPTIONS_EXTRA || "",
  })
  if (spotRes?.error) {
    try {
      const buf = await fs.promises.readFile(cachePath, "utf-8").catch(() => "")
      if (buf) {
        const obj = JSON.parse(buf)
        if (obj?.data) return NextResponse.json(obj, { status: 200 })
      }
    } catch {}
    return NextResponse.json(spotRes, { status: 500 })
  }

  const codes = ["IH", "IF", "IC", "IM"]
  const out: any = { start_date: startYmd, end_date: endYmd, data: {} }
  const debugInputs: any = {}
  for (const code of codes) {
    const futSeries: Array<{ trade_date: string; close: number | null; settle: number | null }> = futRes?.data?.[code] || []
    const spotSeries: Array<{ date: string; close: number }> = spotRes?.data?.[code] || []
    // Build map for spot by ymd
    const spotMap = new Map<string, number>()
    for (const s of spotSeries) {
      if (typeof s?.close === "number") {
        const ymd = s?.date?.replace(/-/g, "")
        spotMap.set(ymd, s.close)
      }
    }
    const series: Array<{ date: string; basis_diff: number | null; spot_close?: number; futures_settle?: number }> = []
    for (const f of futSeries) {
      const ymd: string = f?.trade_date
      const iso = ymdToIso(ymd)
      const spotClose = spotMap.get(ymd)
      const futSettle = typeof f?.settle === "number" ? f.settle : undefined
      let diff: number | null = null
      if (typeof spotClose === "number" && typeof futSettle === "number") {
        diff = futSettle - spotClose
      }
      series.push({ date: iso, basis_diff: diff, spot_close: spotClose, futures_settle: futSettle })
    }
    out.data[code] = series
    // Debug for latest
    try {
      const endIso2 = ymdToIso(endYmd)
      const match = series.find((d) => d.date === endIso2) || series.at(-1)
      const dbg = {
        date: match?.date || null,
        futures_settle: match?.futures_settle ?? null,
        spot_close: match?.spot_close ?? null,
        basis_diff: match?.basis_diff ?? null,
      }
      debugInputs[code] = dbg
      console.log("[basis-diff-ts] inputs", code, dbg)
    } catch {}
  }

  try {
    await fs.promises.writeFile(cachePath, JSON.stringify(out, null, 2), "utf-8")
  } catch (e) {
    console.warn("[basis-diff-timeseries] failed to write cache:", (e as any)?.message)
  }

  const payloadBase = { ...out }
  const payload = debugFlag ? { ...payloadBase, debug_inputs: debugInputs } : payloadBase
  return NextResponse.json(payload, { status: 200 })
}
