/**
 * Tracks recent interactive HTTP traffic so scheduled background jobs
 * can yield CPU, memory, and DB connections to logged-in users.
 *
 * Activity is mirrored to a small JSON file under MARKET_DASHBOARD_STORAGE_DIR
 * so a separate PM2 worker process can see browser traffic from next-server.
 */

import fs from "fs"
import path from "path"

type ActivityState = {
  /** Last user-facing GET/navigation. */
  lastBrowseAt: number
  /** Last POST/PUT/PATCH/DELETE (uploads, saves). */
  lastMutatingAt: number
  /** Rolling timestamps for burst detection. */
  recentHits: number[]
}

const BROWSE_WINDOW_MS = parseInt(process.env.USER_PRIORITY_BROWSE_MS || "30000", 10)
const MUTATING_WINDOW_MS = parseInt(process.env.USER_PRIORITY_MUTATING_MS || "90000", 10)
const BURST_WINDOW_MS = 15_000
const BURST_MIN_HITS = 3
const FILE_WRITE_THROTTLE_MS = 500
const FILE_READ_THROTTLE_MS = 500

declare global {
  // eslint-disable-next-line no-var
  var __userActivityPriority: ActivityState | undefined
  // eslint-disable-next-line no-var
  var __userActivityPriorityLastWriteAt: number | undefined
  // eslint-disable-next-line no-var
  var __userActivityPriorityLastReadAt: number | undefined
  // eslint-disable-next-line no-var
  var __userActivityPriorityFileCache: ActivityState | undefined
}

function state(): ActivityState {
  if (!globalThis.__userActivityPriority) {
    globalThis.__userActivityPriority = {
      lastBrowseAt: 0,
      lastMutatingAt: 0,
      recentHits: [],
    }
  }
  return globalThis.__userActivityPriority
}

function runtimeDir(): string {
  const root =
    process.env.MARKET_DASHBOARD_STORAGE_DIR || path.join(process.cwd(), "data")
  return path.join(root, "runtime")
}

function activityFilePath(): string {
  return path.join(runtimeDir(), "user-activity.json")
}

function isInteractivePath(pathname: string): boolean {
  if (!pathname || pathname.startsWith("/_next/")) return false
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/i.test(pathname)) return false
  if (pathname.startsWith("/_vercel/")) return false
  // Background job status polling should not block the job itself.
  if (pathname.includes("/email-parse-records/fetch-status")) return false
  if (pathname.includes("/mom-analysis/data-import/etl-status")) return false
  // Admin deploy-readiness polling should not look like live user traffic.
  if (pathname.includes("/api/admin/deploy-status")) return false
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/ma/api/") ||
    pathname.startsWith("/ma/dashboard") ||
    pathname.startsWith("/dashboard") ||
    pathname === "/login"
  )
}

function writeActivityFile(s: ActivityState): void {
  try {
    const dir = runtimeDir()
    fs.mkdirSync(dir, { recursive: true })
    const payload = JSON.stringify({
      lastBrowseAt: s.lastBrowseAt,
      lastMutatingAt: s.lastMutatingAt,
      recentHits: s.recentHits.slice(-20),
      updatedAt: Date.now(),
    })
    const target = activityFilePath()
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, payload, "utf8")
    fs.renameSync(tmp, target)
  } catch {
    // never block requests for activity tracking
  }
}

function readActivityFile(): ActivityState | null {
  try {
    const raw = fs.readFileSync(activityFilePath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<ActivityState>
    return {
      lastBrowseAt: typeof parsed.lastBrowseAt === "number" ? parsed.lastBrowseAt : 0,
      lastMutatingAt: typeof parsed.lastMutatingAt === "number" ? parsed.lastMutatingAt : 0,
      recentHits: Array.isArray(parsed.recentHits)
        ? parsed.recentHits.filter((t): t is number => typeof t === "number")
        : [],
    }
  } catch {
    return null
  }
}

function mergeActivity(a: ActivityState, b: ActivityState): ActivityState {
  const recentHits = [...a.recentHits, ...b.recentHits]
    .sort((x, y) => x - y)
    .filter((t, i, arr) => i === 0 || t !== arr[i - 1])
  const cutoff = Date.now() - BURST_WINDOW_MS
  return {
    lastBrowseAt: Math.max(a.lastBrowseAt, b.lastBrowseAt),
    lastMutatingAt: Math.max(a.lastMutatingAt, b.lastMutatingAt),
    recentHits: recentHits.filter((t) => t >= cutoff).slice(-40),
  }
}

function resolvedActivity(): ActivityState {
  const local = state()
  const now = Date.now()
  const lastRead = globalThis.__userActivityPriorityLastReadAt ?? 0
  if (now - lastRead >= FILE_READ_THROTTLE_MS || !globalThis.__userActivityPriorityFileCache) {
    globalThis.__userActivityPriorityLastReadAt = now
    globalThis.__userActivityPriorityFileCache = readActivityFile() ?? {
      lastBrowseAt: 0,
      lastMutatingAt: 0,
      recentHits: [],
    }
  }
  return mergeActivity(local, globalThis.__userActivityPriorityFileCache)
}

/** Called from the edge proxy on each interactive request. */
export function recordInteractiveUserTraffic(pathname: string, method: string): void {
  if (!isInteractivePath(pathname)) return
  const now = Date.now()
  const s = state()
  s.recentHits.push(now)
  const cutoff = now - BURST_WINDOW_MS
  s.recentHits = s.recentHits.filter((t) => t >= cutoff)
  s.lastBrowseAt = now
  const m = method.toUpperCase()
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    s.lastMutatingAt = now
  }

  const lastWrite = globalThis.__userActivityPriorityLastWriteAt ?? 0
  const forceWrite = s.lastMutatingAt === now
  if (forceWrite || now - lastWrite >= FILE_WRITE_THROTTLE_MS) {
    globalThis.__userActivityPriorityLastWriteAt = now
    writeActivityFile(s)
  }
}

/** True when background cron work should defer or abort in favour of users. */
export function shouldYieldBackgroundWorkToUsers(): boolean {
  const now = Date.now()
  const s = resolvedActivity()
  if (s.lastMutatingAt > 0 && now - s.lastMutatingAt < MUTATING_WINDOW_MS) return true
  if (s.lastBrowseAt > 0 && now - s.lastBrowseAt < BROWSE_WINDOW_MS) return true
  if (s.recentHits.length >= BURST_MIN_HITS) return true
  return false
}
