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
function ymdToIso(ymd: string): string { return `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}` }
function expectedTradeDate(): string {
  const now = new Date()
  const wd = now.getDay()
  if (wd === 6) { const d = new Date(now); d.setDate(d.getDate() - 1); return formatYmd(d) }
  if (wd === 0) { const d = new Date(now); d.setDate(d.getDate() - 2); return formatYmd(d) }
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
          try { parsed = JSON.parse(text) } catch (_e) {
            const first = text.indexOf("{")
            const last = text.lastIndexOf("}")
            if (first !== -1 && last !== -1 && last > first) parsed = JSON.parse(text.substring(first, last + 1))
            else throw _e
          }
          resolve(parsed)
        } catch (e: any) { resolve({ error: `json parse failed: ${e?.message}`, stdout, stderr }) }
      })
    } catch (e: any) { resolve({ error: e?.message || "unknown" }) }
  })
}

type Item = { code: string; name: string | null; return_pct: number | null; amount: number | null }

// Sector rules provided by user
const SECTOR_RULES: Record<string, Set<string>> = {
  "农产": new Set(["C", "CS", "WH", "PM", "RR", "RI", "JR", "LR", "A", "B", "M", "Y", "RM", "OI", "RS", "PK", "P", "SR", "CF", "CY", "AP", "CJ", "LH", "JD", "LG", "SP", "OP"]),
  "贵金属": new Set(["AU", "AG", "PT", "PD"]),
  "有色": new Set(["CU", "BC", "AL", "AO", "AD", "ZN", "PB", "NI", "SN"]),
  "新能源": new Set(["LC", "PS", "SI"]),
  "黑色": new Set(["I", "SF", "SM", "RB", "HC", "SS", "WR", "JM", "J", "ZC", "FG", "BB", "FB"]),
  "能源化工": new Set(["SC", "FU", "LU", "PG", "BU", "TA", "EG", "PF", "PR", "PL", "PP", "L", "BZ", "PX", "EB", "RU", "BR", "NR", "SA", "SH", "V", "UR", "MA"]),
  "航运": new Set(["EC"]),
  "股指": new Set(["IH", "IF", "IC", "IM", "MO"]),
  "国债": new Set(["TS", "TF", "T", "TL"]),
}

function productPrefix(code: string): string {
  // Extract segment before '.' and strip trailing digits; only remove single-letter suffix (M/F/X) when length > 2
  const head = (code.split(".")[0] || "").toUpperCase()
  const pNoDigits = head.replace(/[0-9]+$/g, "")
  if (pNoDigits.length > 2 && /[MFX]$/i.test(pNoDigits)) {
    return pNoDigits.slice(0, -1)
  }
  return pNoDigits
}

function categorize(code: string): string {
  const p = productPrefix(code)
  for (const [sector, set] of Object.entries(SECTOR_RULES)) {
    if (set.has(p)) return sector
  }
  return "其他"
}

export async function GET(req: Request) {
  const env = { ...process.env }
  const isWin = process.platform === "win32"
  let pythonExe = process.env.PYTHON_EXE
  const script = path.join(process.cwd(), "scripts/ma/get_choice_all_futures_latest.py")
  const cacheDir = path.join(process.cwd(), "data")
  const cachePath = path.join(cacheDir, "commodity_amount_heatmap.json")
  let dateIso: string | null = null
  let debugFlag = false
  let force = false
  try {
    const url = new URL(req.url)
    debugFlag = url.searchParams.get("debug") === "1"
    const qd = url.searchParams.get("date")
    dateIso = qd && qd.length === 10 ? qd : null
    force = url.searchParams.get("force") === "1"
  } catch {}
  const expectedYmd = expectedTradeDate()
  const tradeIso = dateIso || ymdToIso(expectedYmd)

  const runArgs = (scriptPath: string, arg?: string) => {
    if (isWin && !pythonExe) return ["py", "-3", scriptPath, ...(arg ? [arg] : [])]
    const exe = pythonExe || "python"
    return [exe as string, scriptPath, ...(arg ? [arg] : [])]
  }

  try { await fs.promises.mkdir(cacheDir, { recursive: true }) } catch {}
  // Cache-first on matching date
  try {
    const buf = await fs.promises.readFile(cachePath, "utf-8").catch(() => "")
    if (buf) {
      const obj = JSON.parse(buf)
      const totalAmt = typeof obj?.total_amount === "number" ? obj.total_amount : 0
      if (!force && obj?.trade_date === tradeIso && obj?.data && totalAmt > 0) {
        return NextResponse.json(obj, { status: 200 })
      }
    }
  } catch {}

  const res = await runPython(runArgs(script, tradeIso), {
    ...env,
    PYTHONIOENCODING: "utf-8",
    EMQ_USERNAME: process.env.EMQ_USERNAME || "",
    EMQ_PASSWORD: process.env.EMQ_PASSWORD || "",
    CHOICE_TRADE_DATE: tradeIso,
    CHOICE_DEBUG: debugFlag ? "1" : "0",
  })
  if (res?.error) return NextResponse.json(res, { status: 500 })

  const items: Item[] = Array.isArray(res?.data) ? res.data : []
  // If items are empty or all amounts are zero/null, return error and avoid caching
  const nonZero = items.filter((it) => typeof it.amount === "number" && it.amount > 0)
  // If debug is requested, include raw and sample even when empty
  if (debugFlag && (!items.length || nonZero.length === 0)) {
    const sample = items.slice(0, 8)
    const debugOut: any = {
      trade_date: tradeIso,
      counts: { items: items.length, nonZero: nonZero.length },
      sample,
      raw: res?.raw || null,
    }
    try {
      console.log("[choice-debug]", JSON.stringify(debugOut).slice(0, 1000))
    } catch {}
    return NextResponse.json({ trade_date: tradeIso, total_amount: 0, data: [], debug: debugOut }, { status: 200 })
  }
  if (!items.length || nonZero.length === 0) {
    return NextResponse.json({ error: "choice data empty", trade_date: tradeIso }, { status: 502 })
  }
  // Group by sector for treemap
  const groups: Record<string, { name: string; children: Array<{ name: string; value: number; ret: number | null }> }> = {}
  let totalAmt = 0
  for (const it of items) {
    const cat = categorize(it.code || "")
    const amt = typeof it.amount === "number" ? it.amount : 0
    const ret = typeof it.return_pct === "number" ? it.return_pct : null
    totalAmt += amt
    const display = it.name ? it.name : it.code
    if (!groups[cat]) groups[cat] = { name: cat, children: [] }
    groups[cat].children.push({ name: display, value: amt, ret })
  }
  const treemap = Object.values(groups)
  const payload: any = { trade_date: tradeIso, total_amount: totalAmt, data: treemap }
  if (debugFlag) {
    payload.debug = {
      counts: { items: items.length, nonZero: nonZero.length },
      sample: items.slice(0, 8),
      raw: res?.raw || null,
      dump: (res as any)?.raw?.dump || null,
    }
  }
  if (debugFlag) payload.raw = items

  try { await fs.promises.writeFile(cachePath, JSON.stringify(payload, null, 2), "utf-8") } catch {}
  return NextResponse.json(payload, { status: 200 })
}
