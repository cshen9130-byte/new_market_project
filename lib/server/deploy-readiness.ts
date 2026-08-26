/**
 * Deploy-readiness snapshot for admins: recent nginx traffic + in-app activity file.
 */

import fs from "fs"
import path from "path"
import {
  getRecentUserHits,
  shouldYieldBackgroundWorkToUsers,
  type RecentUserHit,
} from "@/lib/server/user-activity-priority"

export type DeployTrafficWindow = {
  minutes: number
  label: string
  requests: number
  productRequests: number
  uniqueIps: string[]
}

export type DeployLastRequest = {
  at: string
  ip: string
  method: string
  path: string
  status: number
}

export type DeployActiveUser = {
  userId: string
  lastPath: string
  agoSec: number
}

export type DeployReadiness = {
  checkedAt: string
  goodToDeploy: boolean
  level: "good" | "caution" | "busy" | "unknown"
  reason: string
  windows: DeployTrafficWindow[]
  lastRequest: DeployLastRequest | null
  topPaths5m: Array<{ path: string; count: number }>
  activity: {
    available: boolean
    browseAgoSec: number | null
    mutateAgoSec: number | null
    recentHits15s: number
    yieldingBackgroundWork: boolean
  }
  nginx: {
    path: string | null
    readable: boolean
    error?: string
  }
  viewerIp: string | null
  otherActiveIps5m: string[]
  otherActiveUsers5m: DeployActiveUser[]
  productHits5m: number
  productHits15m: number
}

const NGINX_TIME_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) ([^"]*) HTTP\/[^"]*" (\d+)/
const STATIC_EXT_RE = /\.(?:js|css|png|jpg|jpeg|gif|webp|ico|svg|woff2?|map|txt)$/i

function candidateNginxLogs(): string[] {
  const fromEnv = (process.env.NGINX_ACCESS_LOG || "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
  return [
    ...fromEnv,
    "/var/log/nginx/access.log",
    "/var/log/nginx/market_dashboard_website.access.log",
  ]
}

function activityFilePath(): string {
  const root =
    process.env.MARKET_DASHBOARD_STORAGE_DIR || path.join(process.cwd(), "data")
  return path.join(root, "runtime", "user-activity.json")
}

function isIgnoredPath(urlPath: string): boolean {
  if (!urlPath || urlPath.startsWith("/_next/")) return true
  if (STATIC_EXT_RE.test(urlPath)) return true
  if (urlPath.includes("/api/admin/deploy-status")) return true
  if (urlPath.includes("/api/presence")) return true
  return false
}

/** Admin checking this page — not "someone using the product". */
function isAdminSelfPath(urlPath: string): boolean {
  if (urlPath.startsWith("/dashboard/admin")) return true
  if (urlPath.startsWith("/api/admin/")) return true
  if (urlPath.includes("/api/presence")) return true
  return false
}

/** Logged-in product usage that should block a casual deploy. */
function isProductHit(urlPath: string): boolean {
  if (isIgnoredPath(urlPath) || isAdminSelfPath(urlPath)) return false
  if (urlPath === "/login") return false
  return (
    urlPath.startsWith("/ma/") ||
    urlPath.startsWith("/dashboard") ||
    urlPath.startsWith("/api/")
  )
}

function parseNginxTime(ts: string): Date | null {
  // 11/Aug/2026:15:30:01 +0800
  const m = ts.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/)
  if (!m) return null
  const [, dd, mon, yyyy, hh, mm, ss, tz] = m
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  }
  const month = months[mon]
  if (!month) return null
  const iso = `${yyyy}-${month}-${dd}T${hh}:${mm}:${ss}${tz.slice(0, 3)}:${tz.slice(3)}`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function readTailText(filePath: string, maxBytes = 2_000_000): string {
  const fd = fs.openSync(filePath, "r")
  try {
    const stat = fs.fstatSync(fd)
    const size = stat.size
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, start)
    return buf.toString("utf8")
  } finally {
    fs.closeSync(fd)
  }
}

type ParsedHit = {
  at: Date
  ip: string
  method: string
  path: string
  status: number
}

function parseNginxHits(logPath: string, sinceMs: number): ParsedHit[] {
  const text = readTailText(logPath)
  const cutoff = Date.now() - sinceMs
  const hits: ParsedHit[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(NGINX_TIME_RE)
    if (!m) continue
    const [, ip, ts, method, rawUrl, statusStr] = m
    const at = parseNginxTime(ts)
    if (!at || at.getTime() < cutoff) continue
    const urlPath = (rawUrl || "/").split("?")[0] || "/"
    if (isIgnoredPath(urlPath)) continue
    hits.push({
      at,
      ip,
      method,
      path: urlPath,
      status: parseInt(statusStr, 10) || 0,
    })
  }
  return hits
}

function windowStats(hits: ParsedHit[], minutes: number): DeployTrafficWindow {
  const cutoff = Date.now() - minutes * 60_000
  const subset = hits.filter((h) => h.at.getTime() >= cutoff)
  const ips = [...new Set(subset.map((h) => h.ip))].sort()
  return {
    minutes,
    label: `${minutes}m`,
    requests: subset.length,
    productRequests: subset.filter((h) => isProductHit(h.path)).length,
    uniqueIps: ips,
  }
}

function readActivitySnapshot(): DeployReadiness["activity"] {
  const yieldingBackgroundWork = shouldYieldBackgroundWorkToUsers()
  try {
    const raw = fs.readFileSync(activityFilePath(), "utf8")
    const parsed = JSON.parse(raw) as {
      lastBrowseAt?: number
      lastMutatingAt?: number
      recentHits?: number[]
    }
    const now = Date.now()
    const browse = typeof parsed.lastBrowseAt === "number" ? parsed.lastBrowseAt : 0
    const mutate = typeof parsed.lastMutatingAt === "number" ? parsed.lastMutatingAt : 0
    const hits = Array.isArray(parsed.recentHits)
      ? parsed.recentHits.filter((t): t is number => typeof t === "number")
      : []
    return {
      available: true,
      browseAgoSec: browse > 0 ? Math.max(0, (now - browse) / 1000) : null,
      mutateAgoSec: mutate > 0 ? Math.max(0, (now - mutate) / 1000) : null,
      recentHits15s: hits.filter((t) => now - t <= 15_000).length,
      yieldingBackgroundWork,
    }
  } catch {
    return {
      available: false,
      browseAgoSec: null,
      mutateAgoSec: null,
      recentHits15s: 0,
      yieldingBackgroundWork,
    }
  }
}

function usersInWindow(users: RecentUserHit[], minutes: number, viewerUserId: string | null): DeployActiveUser[] {
  const cutoff = Date.now() - minutes * 60_000
  const now = Date.now()
  return users
    .filter((u) => u.lastAt >= cutoff && (!viewerUserId || u.userId !== viewerUserId))
    .map((u) => ({
      userId: u.userId,
      lastPath: u.lastPath,
      agoSec: Math.max(0, (now - u.lastAt) / 1000),
    }))
}

function decideLevel(args: {
  nginxReadable: boolean
  otherIps5m: string[]
  otherIps15m: string[]
  otherUsers5m: DeployActiveUser[]
  otherUsers15m: DeployActiveUser[]
  productHits5m: number
  productHits15m: number
  activity: DeployReadiness["activity"]
}): Pick<DeployReadiness, "goodToDeploy" | "level" | "reason"> {
  const {
    nginxReadable,
    otherIps5m,
    otherIps15m,
    otherUsers5m,
    otherUsers15m,
    productHits5m,
    productHits15m,
    activity,
  } = args

  if (nginxReadable) {
    if (otherUsers5m.length > 0) {
      return {
        goodToDeploy: false,
        level: "busy",
        reason: `近 5 分钟有 ${otherUsers5m.length} 位已登录同事在使用，不建议现在部署`,
      }
    }
    if (productHits5m > 0) {
      return {
        goodToDeploy: false,
        level: "busy",
        reason:
          `近 5 分钟仍有 ${productHits5m} 次业务访问。同一出口 IP 下的同事不会被算作「其他 IP」，不建议现在部署`,
      }
    }
    if (otherIps5m.length > 0) {
      return {
        goodToDeploy: false,
        level: "busy",
        reason: `近 5 分钟有 ${otherIps5m.length} 个其他 IP 在访问，不建议现在部署`,
      }
    }
    if (otherUsers15m.length > 0 || productHits15m > 0 || otherIps15m.length > 0) {
      const bits: string[] = []
      if (otherUsers15m.length > 0) bits.push(`${otherUsers15m.length} 位同事`)
      if (otherIps15m.length > 0) bits.push(`${otherIps15m.length} 个其他 IP`)
      if (productHits15m > 0) bits.push(`${productHits15m} 次业务访问`)
      return {
        goodToDeploy: true,
        level: "caution",
        reason: `近 5 分钟空闲，但 15 分钟内有 ${bits.join("、")}，可部署但留意`,
      }
    }
    return {
      goodToDeploy: true,
      level: "good",
      reason: "近 15 分钟无业务访问（不含本页检查），适合部署",
    }
  }

  // Fallback: in-app activity file only (e.g. local/dev without nginx log access)
  if (activity.available || otherUsers5m.length > 0 || otherUsers15m.length > 0) {
    if (otherUsers5m.length > 0) {
      return {
        goodToDeploy: false,
        level: "busy",
        reason: `近 5 分钟有 ${otherUsers5m.length} 位已登录同事在使用，不建议现在部署`,
      }
    }
    const browseOk = activity.browseAgoSec == null || activity.browseAgoSec >= 300
    const mutateOk = activity.mutateAgoSec == null || activity.mutateAgoSec >= 300
    if (browseOk && mutateOk && !activity.yieldingBackgroundWork && otherUsers15m.length === 0) {
      return {
        goodToDeploy: true,
        level: "good",
        reason: "应用内活动文件显示近 5 分钟无交互流量，适合部署",
      }
    }
    if (activity.yieldingBackgroundWork || (activity.browseAgoSec != null && activity.browseAgoSec < 60)) {
      return {
        goodToDeploy: false,
        level: "busy",
        reason: "应用内刚检测到交互流量，不建议现在部署",
      }
    }
    return {
      goodToDeploy: true,
      level: "caution",
      reason: "无 nginx 日志可读；仅按应用内活动判断，建议再确认",
    }
  }

  return {
    goodToDeploy: false,
    level: "unknown",
    reason: "无法读取 nginx 访问日志或活动文件，状态未知",
  }
}

export function getDeployReadiness(viewerIp?: string | null, viewerUserId?: string | null): DeployReadiness {
  const checkedAt = new Date().toISOString()
  const activity = readActivitySnapshot()
  const viewer = viewerIp?.trim() || null
  const viewerUser = viewerUserId?.trim() || null

  let nginxPath: string | null = null
  let nginxReadable = false
  let nginxError: string | undefined
  let hits: ParsedHit[] = []

  for (const candidate of candidateNginxLogs()) {
    try {
      if (!fs.existsSync(candidate)) continue
      fs.accessSync(candidate, fs.constants.R_OK)
      hits = parseNginxHits(candidate, 60 * 60_000)
      nginxPath = candidate
      nginxReadable = true
      break
    } catch (e: any) {
      nginxPath = candidate
      nginxError = e?.message || String(e)
    }
  }

  const windows = [1, 5, 15, 60].map((m) => windowStats(hits, m))
  const w5 = windows.find((w) => w.minutes === 5)!
  const w15 = windows.find((w) => w.minutes === 15)!
  const otherActiveIps5m = w5.uniqueIps.filter((ip) => !viewer || ip !== viewer)
  const otherActiveIps15m = w15.uniqueIps.filter((ip) => !viewer || ip !== viewer)
  const productHits5m = w5.productRequests
  const productHits15m = w15.productRequests

  const recentUsers = getRecentUserHits(60 * 60_000)
  const otherActiveUsers5m = usersInWindow(recentUsers, 5, viewerUser)
  const otherActiveUsers15m = usersInWindow(recentUsers, 15, viewerUser)

  const last = hits.length > 0 ? hits[hits.length - 1] : null
  const topMap = new Map<string, number>()
  const cutoff5 = Date.now() - 5 * 60_000
  for (const h of hits) {
    if (h.at.getTime() < cutoff5) continue
    if (isAdminSelfPath(h.path)) continue
    topMap.set(h.path, (topMap.get(h.path) || 0) + 1)
  }
  const topPaths5m = [...topMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([p, count]) => ({ path: p, count }))

  const decision = decideLevel({
    nginxReadable,
    otherIps5m: otherActiveIps5m,
    otherIps15m: otherActiveIps15m,
    otherUsers5m: otherActiveUsers5m,
    otherUsers15m: otherActiveUsers15m,
    productHits5m,
    productHits15m,
    activity,
  })

  return {
    checkedAt,
    ...decision,
    windows,
    lastRequest: last
      ? {
          at: last.at.toISOString(),
          ip: last.ip,
          method: last.method,
          path: last.path,
          status: last.status,
        }
      : null,
    topPaths5m,
    activity,
    nginx: {
      path: nginxPath,
      readable: nginxReadable,
      ...(nginxError && !nginxReadable ? { error: nginxError } : {}),
    },
    viewerIp: viewer,
    otherActiveIps5m,
    otherActiveUsers5m,
    productHits5m,
    productHits15m,
  }
}

export function clientIpFromRequest(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get("x-real-ip")?.trim()
  if (real) return real
  return null
}
