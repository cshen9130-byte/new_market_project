/** File-backed job log so 获取/计算 lines survive Next.js request isolation. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"

export type JobLogLine = {
  t: string
  src: "fetch" | "etl" | "job"
  msg: string
}

const LOG_DIR = path.join(process.cwd(), "data", "account-risk")
const LOG_FILE = path.join(LOG_DIR, "job-log.jsonl")
const MAX = 500
const listeners = new Set<(line: JobLogLine) => void>()

function ensureDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
}

export function appendJobLog(src: JobLogLine["src"], msg: string) {
  const line: JobLogLine = { t: new Date().toISOString(), src, msg }
  try {
    ensureDir()
    appendFileSync(LOG_FILE, `${JSON.stringify(line)}\n`, "utf8")
  } catch { /* non-fatal */ }
  for (const fn of listeners) {
    try { fn(line) } catch { /* ignore */ }
  }
}

export function getJobLogSnapshot(): JobLogLine[] {
  try {
    if (!existsSync(LOG_FILE)) return []
    const out: JobLogLine[] = []
    for (const raw of readFileSync(LOG_FILE, "utf8").split(/\r?\n/)) {
      if (!raw.trim()) continue
      try {
        const row = JSON.parse(raw) as JobLogLine
        if (row?.msg) out.push(row)
      } catch { /* skip bad line */ }
    }
    return out.slice(-MAX)
  } catch {
    return []
  }
}

export function clearJobLog() {
  try {
    ensureDir()
    writeFileSync(LOG_FILE, "", "utf8")
  } catch { /* ignore */ }
}

export function subscribeJobLog(fn: (line: JobLogLine) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
