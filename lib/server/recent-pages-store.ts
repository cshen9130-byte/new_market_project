import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"
import {
  mergeRecentPages,
  parseRecentPagesPayload,
  type RecentPageHit,
} from "@/lib/client/recent-pages"

function storageDir() {
  return getServerStoragePath("recent-pages")
}

function userFile(userId: string) {
  const safe = userId.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 80)
  return path.join(storageDir(), `${safe || "unknown"}.json`)
}

export function readRecentPages(userId: string): RecentPageHit[] {
  const file = userFile(userId)
  for (const candidate of [file, `${file}.bak`]) {
    if (!existsSync(candidate)) continue
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { pages?: unknown }
      return parseRecentPagesPayload(parsed?.pages ?? parsed)
    } catch {
      continue
    }
  }
  return []
}

export function writeRecentPages(userId: string, incoming: RecentPageHit[]): RecentPageHit[] {
  const merged = mergeRecentPages(readRecentPages(userId), incoming)
  const file = userFile(userId)
  mkdirSync(path.dirname(file), { recursive: true })
  const json = JSON.stringify({ updatedAt: new Date().toISOString(), pages: merged })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, json, "utf8")
  if (existsSync(file)) {
    try {
      writeFileSync(`${file}.bak`, readFileSync(file))
    } catch {
      // ignore backup failure
    }
    try {
      unlinkSync(file)
    } catch {
      // Windows rename cannot replace an existing file
    }
  }
  renameSync(tmp, file)
  return merged
}
