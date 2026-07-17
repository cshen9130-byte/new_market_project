/**
 * Tracks recent interactive HTTP traffic so scheduled background jobs (2h email
 * ETL) can yield CPU, memory, and DB connections to logged-in users.
 */

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

declare global {
  // eslint-disable-next-line no-var
  var __userActivityPriority: ActivityState | undefined
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

function isInteractivePath(pathname: string): boolean {
  if (!pathname || pathname.startsWith("/_next/")) return false
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/i.test(pathname)) return false
  if (pathname.startsWith("/_vercel/")) return false
  // Background job status polling should not block the job itself.
  if (pathname.includes("/email-parse-records/fetch-status")) return false
  if (pathname.includes("/mom-analysis/data-import/etl-status")) return false
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/ma/api/") ||
    pathname.startsWith("/ma/dashboard") ||
    pathname.startsWith("/dashboard") ||
    pathname === "/login"
  )
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
}

/** True when background cron work should defer or abort in favour of users. */
export function shouldYieldBackgroundWorkToUsers(): boolean {
  const now = Date.now()
  const s = state()
  if (s.lastMutatingAt > 0 && now - s.lastMutatingAt < MUTATING_WINDOW_MS) return true
  if (s.lastBrowseAt > 0 && now - s.lastBrowseAt < BROWSE_WINDOW_MS) return true
  if (s.recentHits.length >= BURST_MIN_HITS) return true
  return false
}
