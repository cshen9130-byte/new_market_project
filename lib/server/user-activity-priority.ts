/**
 * Tracks recent interactive HTTP traffic so scheduled background jobs
 * can yield CPU, memory, and DB connections to logged-in users.
 *
 * Activity is mirrored to a small JSON file under MARKET_DASHBOARD_STORAGE_DIR
 * so a separate PM2 worker process can see browser traffic from next-server.
 */

import fs from "fs"
import path from "path"

export type RecentUserHit = {
  userId: string
  lastAt: number
  lastPath: string
}

type ActivityState = {
  /** Last user-facing GET/navigation. */
  lastBrowseAt: number
  /** Last POST/PUT/PATCH/DELETE (uploads, saves). */
  lastMutatingAt: number
  /** Rolling timestamps for burst detection. */
  recentHits: number[]
  /** Last seen logged-in users (from x-market-user-id / presence). */
  recentUsers: RecentUserHit[]
}

const BROWSE_WINDOW_MS = parseInt(process.env.USER_PRIORITY_BROWSE_MS || "30000", 10)
const MUTATING_WINDOW_MS = parseInt(process.env.USER_PRIORITY_MUTATING_MS || "90000", 10)
const BURST_WINDOW_MS = 15_000
const BURST_MIN_HITS = 3
const FILE_WRITE_THROTTLE_MS = 500
const FILE_READ_THROTTLE_MS = 500
const RECENT_USER_WINDOW_MS = 60 * 60_000
const USER_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/

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
      recentUsers: [],
    }
  }
  if (!Array.isArray(globalThis.__userActivityPriority.recentUsers)) {
    globalThis.__userActivityPriority.recentUsers = []
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
  if (pathname.includes("/api/presence")) return false
  if (pathname.startsWith("/dashboard/admin")) return false
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
      recentUsers: pruneRecentUsers(s.recentUsers),
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

function parseRecentUsers(raw: unknown): RecentUserHit[] {
  if (!Array.isArray(raw)) return []
  const out: RecentUserHit[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const userId = typeof (item as RecentUserHit).userId === "string"
      ? (item as RecentUserHit).userId.trim()
      : ""
    const lastAt = (item as RecentUserHit).lastAt
    const lastPath = typeof (item as RecentUserHit).lastPath === "string"
      ? (item as RecentUserHit).lastPath
      : ""
    if (!USER_ID_RE.test(userId) || typeof lastAt !== "number" || !Number.isFinite(lastAt)) continue
    out.push({ userId, lastAt, lastPath })
  }
  return pruneRecentUsers(out)
}

function pruneRecentUsers(users: RecentUserHit[]): RecentUserHit[] {
  const cutoff = Date.now() - RECENT_USER_WINDOW_MS
  const map = new Map<string, RecentUserHit>()
  for (const u of users) {
    if (u.lastAt < cutoff) continue
    const prev = map.get(u.userId)
    if (!prev || u.lastAt > prev.lastAt) map.set(u.userId, u)
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 50)
}

function emptyActivity(): ActivityState {
  return {
    lastBrowseAt: 0,
    lastMutatingAt: 0,
    recentHits: [],
    recentUsers: [],
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
      recentUsers: parseRecentUsers(parsed.recentUsers),
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
    recentUsers: pruneRecentUsers([...(a.recentUsers || []), ...(b.recentUsers || [])]),
  }
}

function resolvedActivity(): ActivityState {
  const local = state()
  const now = Date.now()
  const lastRead = globalThis.__userActivityPriorityLastReadAt ?? 0
  if (now - lastRead >= FILE_READ_THROTTLE_MS || !globalThis.__userActivityPriorityFileCache) {
    globalThis.__userActivityPriorityLastReadAt = now
    globalThis.__userActivityPriorityFileCache = readActivityFile() ?? emptyActivity()
  }
  return mergeActivity(local, globalThis.__userActivityPriorityFileCache)
}

function upsertRecentUser(s: ActivityState, userId: string | null | undefined, pathname: string, at: number): void {
  const id = userId?.trim() || ""
  if (!USER_ID_RE.test(id)) return
  const hit: RecentUserHit = { userId: id, lastAt: at, lastPath: pathname || "/" }
  const idx = s.recentUsers.findIndex((u) => u.userId === id)
  if (idx >= 0) s.recentUsers[idx] = hit
  else s.recentUsers.push(hit)
  s.recentUsers = pruneRecentUsers(s.recentUsers)
}

/** Called from the edge proxy / presence ping on each interactive request. */
export function recordInteractiveUserTraffic(
  pathname: string,
  method: string,
  userId?: string | null,
): void {
  const interactive = isInteractivePath(pathname)
  const id = userId?.trim() || ""
  if (!interactive && !USER_ID_RE.test(id)) return
  const now = Date.now()
  const s = state()
  if (interactive) {
    s.recentHits.push(now)
    const cutoff = now - BURST_WINDOW_MS
    s.recentHits = s.recentHits.filter((t) => t >= cutoff)
    s.lastBrowseAt = now
    const m = method.toUpperCase()
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
      s.lastMutatingAt = now
    }
  }
  upsertRecentUser(s, id, pathname, now)

  const lastWrite = globalThis.__userActivityPriorityLastWriteAt ?? 0
  const forceWrite = s.lastMutatingAt === now || Boolean(id)
  if (forceWrite || now - lastWrite >= FILE_WRITE_THROTTLE_MS) {
    globalThis.__userActivityPriorityLastWriteAt = now
    writeActivityFile(s)
  }
}

export function getRecentUserHits(sinceMs = RECENT_USER_WINDOW_MS): RecentUserHit[] {
  const cutoff = Date.now() - sinceMs
  return pruneRecentUsers(resolvedActivity().recentUsers || []).filter((u) => u.lastAt >= cutoff)
}

export type YieldToUsersOptions = {
  /**
   * When true, only yield for uploads/saves — not for dashboard browsing or
   * list polling. The 5-minute mailbox poll runs on the dedicated worker; if
   * it also waits on GET traffic, NAV mail sits unparsed all afternoon.
   */
  mutatingOnly?: boolean
}

/** True when background cron work should defer or abort in favour of users. */
export function shouldYieldBackgroundWorkToUsers(options?: YieldToUsersOptions): boolean {
  const now = Date.now()
  const s = resolvedActivity()
  if (s.lastMutatingAt > 0 && now - s.lastMutatingAt < MUTATING_WINDOW_MS) return true
  if (options?.mutatingOnly) return false
  if (s.lastBrowseAt > 0 && now - s.lastBrowseAt < BROWSE_WINDOW_MS) return true
  if (s.recentHits.length >= BURST_MIN_HITS) return true
  return false
}
