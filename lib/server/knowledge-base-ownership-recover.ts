import { promises as fs } from "fs"
import path from "path"
import {
  getKnowledgeBaseOwnershipFilePath,
  getKnowledgeBaseOwnershipStorageDir,
  getKnowledgeBaseStorageRoot,
  normalizeKnowledgeBasePath,
  readKnowledgeBaseOwnershipRecords,
  replaceKnowledgeBaseOwnershipRecords,
  type KnowledgeBaseOwnershipRecord,
} from "@/lib/server/knowledge-base"
import { listUsers } from "@/lib/server/users"

export type OwnershipRecoverSource =
  | "current"
  | "backup"
  | "tmp"
  | "notes-meta"
  | "name-prefix"
  | "child-infer"

export type OwnershipRecoverReport = {
  beforeCount: number
  afterCount: number
  addedCount: number
  sources: Record<OwnershipRecoverSource, number>
  backupFilesUsed: string[]
  sampleAdded: Array<{ relativePath: string; ownerName: string; source: OwnershipRecoverSource }>
  dryRun: boolean
}

type RecoverUser = {
  id: string
  name: string
  email: string
}

type Candidate = KnowledgeBaseOwnershipRecord & { source: OwnershipRecoverSource }

function isUsableRecord(value: unknown): value is KnowledgeBaseOwnershipRecord {
  if (!value || typeof value !== "object") return false
  const record = value as KnowledgeBaseOwnershipRecord
  return Boolean(
    typeof record.relativePath === "string" &&
      record.relativePath.trim() &&
      typeof record.ownerId === "string" &&
      record.ownerId.trim() &&
      typeof record.ownerName === "string" &&
      record.ownerName.trim() &&
      record.ownerName !== "-" &&
      record.ownerName !== "未知",
  )
}

function preferRecord(current: Candidate | undefined, next: Candidate): Candidate {
  if (!current) return next

  // Never drop a lock flag.
  if (next.locked && !current.locked) return { ...next, locked: true }
  if (current.locked && !next.locked) return { ...current, locked: true }

  const currentTime = Date.parse(current.uploadedAt || "")
  const nextTime = Date.parse(next.uploadedAt || "")
  const currentValid = !Number.isNaN(currentTime)
  const nextValid = !Number.isNaN(nextTime)

  // Prefer the earliest known upload time (original uploader).
  if (nextValid && (!currentValid || nextTime < currentTime)) {
    return current.locked ? { ...next, locked: true } : next
  }

  // Prefer richer metadata when timestamps tie / missing.
  if (!current.ownerEmail && next.ownerEmail) {
    return current.locked ? { ...next, locked: true } : next
  }

  return current.locked || next.locked ? { ...current, locked: true } : current
}

async function readRecordsFromFile(filePath: string): Promise<KnowledgeBaseOwnershipRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isUsableRecord).map((record) => ({
      ...record,
      relativePath: normalizeKnowledgeBasePath(record.relativePath),
      uploadedAt: record.uploadedAt || new Date(0).toISOString(),
    })).filter((record) => Boolean(record.relativePath))
  } catch {
    return []
  }
}

async function listRecoverCandidateFiles(): Promise<Array<{ filePath: string; source: OwnershipRecoverSource }>> {
  const ownershipFile = getKnowledgeBaseOwnershipFilePath()
  const ownershipDir = getKnowledgeBaseOwnershipStorageDir()
  const found: Array<{ filePath: string; source: OwnershipRecoverSource }> = []

  found.push({ filePath: ownershipFile, source: "current" })

  try {
    const entries = await fs.readdir(ownershipDir)
    for (const name of entries) {
      if (name === "file-owners.json") continue
      if (name === "file-owners.json.lock") continue

      const fullPath = path.join(ownershipDir, name)
      if (name.startsWith("file-owners.json.bak")) {
        found.push({ filePath: fullPath, source: "backup" })
        continue
      }
      if (name.startsWith("file-owners.json.") && name.endsWith(".tmp")) {
        found.push({ filePath: fullPath, source: "tmp" })
        continue
      }
      // Common editor / manual copies
      if (/^file-owners(\.json)?(\.old|\.orig|\.copy|\.save)?$/i.test(name) || name.includes("file-owners")) {
        if (name.endsWith(".json") || name.includes("file-owners.json")) {
          found.push({ filePath: fullPath, source: "backup" })
        }
      }
    }
  } catch {
    // metadata dir may be empty
  }

  // De-dupe by absolute path
  const seen = new Set<string>()
  return found.filter((item) => {
    const key = path.resolve(item.filePath)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function loadNotesMetaRecords(): Promise<Candidate[]> {
  const root = getKnowledgeBaseStorageRoot()
  const notesMetaPath = path.join(root, "在线笔记", "_notes_meta.json")
  try {
    const raw = await fs.readFile(notesMetaPath, "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const out: Candidate[] = []
    let folderOwner: Candidate | null = null

    for (const entry of parsed) {
      const relativePath = normalizeKnowledgeBasePath(String(entry?.relativePath || ""))
      const ownerId = String(entry?.createdBy || "").trim()
      const ownerName = String(entry?.createdByName || "").trim()
      const uploadedAt = String(entry?.createdAt || entry?.updatedAt || "").trim() || new Date(0).toISOString()
      if (!relativePath || !ownerId || !ownerName) continue

      const fileRecord: Candidate = {
        relativePath,
        entryType: "file",
        ownerId,
        ownerName,
        uploadedAt,
        source: "notes-meta",
      }
      out.push(fileRecord)

      if (!folderOwner) {
        folderOwner = {
          relativePath: "在线笔记",
          entryType: "folder",
          ownerId,
          ownerName,
          uploadedAt,
          source: "notes-meta",
        }
      } else {
        const currentTime = Date.parse(folderOwner.uploadedAt)
        const nextTime = Date.parse(uploadedAt)
        if (!Number.isNaN(nextTime) && (Number.isNaN(currentTime) || nextTime < currentTime)) {
          folderOwner = {
            relativePath: "在线笔记",
            entryType: "folder",
            ownerId,
            ownerName,
            uploadedAt,
            source: "notes-meta",
          }
        }
      }
    }

    if (folderOwner) out.push(folderOwner)
    return out
  } catch {
    return []
  }
}

function buildUserMatchers(users: RecoverUser[]) {
  const byKey = new Map<string, RecoverUser>()
  for (const user of users) {
    const nameKey = user.name.trim().toLowerCase()
    if (nameKey) byKey.set(nameKey, user)
    const emailLocal = user.email.split("@")[0]?.trim().toLowerCase()
    if (emailLocal) byKey.set(emailLocal, user)
  }
  return byKey
}

function matchOwnerPrefix(baseName: string, usersByKey: Map<string, RecoverUser>): RecoverUser | null {
  const dash = baseName.indexOf("-")
  if (dash <= 0) return null
  const prefix = baseName.slice(0, dash).trim().toLowerCase()
  if (!prefix || prefix.length < 2) return null
  return usersByKey.get(prefix) || null
}

async function collectNamePrefixRecords(users: RecoverUser[]): Promise<Candidate[]> {
  const root = getKnowledgeBaseStorageRoot()
  const usersByKey = buildUserMatchers(users)
  const out: Candidate[] = []

  async function walk(absoluteDir: string, relativeDir: string) {
    let entries: Awaited<ReturnType<typeof fs.readdir>>
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (entry.name === "_notes_meta.json") continue

      const absolutePath = path.join(absoluteDir, entry.name)
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      const owner = matchOwnerPrefix(entry.name, usersByKey)
      if (owner) {
        let uploadedAt = new Date(0).toISOString()
        try {
          const stat = await fs.stat(absolutePath)
          uploadedAt = stat.mtime.toISOString()
        } catch {
          // keep epoch
        }
        out.push({
          relativePath: normalizeKnowledgeBasePath(relativePath),
          entryType: entry.isDirectory() ? "folder" : "file",
          ownerId: owner.id,
          ownerName: owner.name,
          ownerEmail: owner.email,
          uploadedAt,
          source: "name-prefix",
        })
      }

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath)
      }
    }
  }

  await walk(root, "")
  return out.filter((record) => Boolean(record.relativePath))
}

function inferFolderOwnersFromChildren(records: Candidate[]): Candidate[] {
  const byPath = new Map<string, Candidate>()
  for (const record of records) {
    byPath.set(record.relativePath, preferRecord(byPath.get(record.relativePath), record))
  }

  const inferred: Candidate[] = []
  for (const record of byPath.values()) {
    const parts = record.relativePath.split("/").filter(Boolean)
    for (let index = 0; index < parts.length - 1; index += 1) {
      const folderPath = parts.slice(0, index + 1).join("/")
      if (byPath.has(folderPath)) continue
      const existing = inferred.find((item) => item.relativePath === folderPath)
      const candidate: Candidate = {
        relativePath: folderPath,
        entryType: "folder",
        ownerId: record.ownerId,
        ownerName: record.ownerName,
        ownerEmail: record.ownerEmail,
        uploadedAt: record.uploadedAt,
        source: "child-infer",
      }
      if (!existing) {
        inferred.push(candidate)
      } else {
        const preferred = preferRecord(existing, candidate)
        Object.assign(existing, preferred)
      }
    }
  }

  return inferred
}

export async function recoverKnowledgeBaseOwnership(options?: {
  dryRun?: boolean
  useNamePrefix?: boolean
}): Promise<OwnershipRecoverReport> {
  const dryRun = options?.dryRun === true
  const useNamePrefix = options?.useNamePrefix !== false

  const before = await readKnowledgeBaseOwnershipRecords()
  const merged = new Map<string, Candidate>()
  const sources: Record<OwnershipRecoverSource, number> = {
    current: 0,
    backup: 0,
    tmp: 0,
    "notes-meta": 0,
    "name-prefix": 0,
    "child-infer": 0,
  }
  const backupFilesUsed: string[] = []
  const sampleAdded: OwnershipRecoverReport["sampleAdded"] = []

  const absorb = (records: Candidate[]) => {
    for (const record of records) {
      if (!isUsableRecord(record)) continue
      const relativePath = normalizeKnowledgeBasePath(record.relativePath)
      if (!relativePath) continue
      const next = { ...record, relativePath }
      merged.set(relativePath, preferRecord(merged.get(relativePath), next))
    }
  }

  const candidateFiles = await listRecoverCandidateFiles()
  for (const item of candidateFiles) {
    const records = await readRecordsFromFile(item.filePath)
    if (!records.length) continue
    if (item.source === "backup" || item.source === "tmp") {
      backupFilesUsed.push(item.filePath)
    }
    absorb(records.map((record) => ({ ...record, source: item.source })))
  }

  absorb(await loadNotesMetaRecords())

  if (useNamePrefix) {
    let users: RecoverUser[] = []
    try {
      const listed = await listUsers()
      users = listed.map((user) => ({ id: user.id, name: user.name, email: user.email }))
    } catch {
      users = []
    }
    if (users.length) {
      absorb(await collectNamePrefixRecords(users))
    }
  }

  absorb(inferFolderOwnersFromChildren([...merged.values()]))

  for (const key of Object.keys(sources) as OwnershipRecoverSource[]) {
    sources[key] = 0
  }
  for (const record of merged.values()) {
    sources[record.source] += 1
  }

  const beforePaths = new Set(before.map((record) => record.relativePath))
  const afterRecords: KnowledgeBaseOwnershipRecord[] = [...merged.values()]
    .map(({ source: _source, ...record }) => record)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))

  for (const record of afterRecords) {
    if (beforePaths.has(record.relativePath)) continue
    const source = merged.get(record.relativePath)?.source || "backup"
    if (sampleAdded.length < 30) {
      sampleAdded.push({
        relativePath: record.relativePath,
        ownerName: record.ownerName,
        source,
      })
    }
  }

  if (!dryRun) {
    await replaceKnowledgeBaseOwnershipRecords(afterRecords)
  }

  return {
    beforeCount: before.length,
    afterCount: afterRecords.length,
    addedCount: Math.max(0, afterRecords.length - before.length),
    sources,
    backupFilesUsed,
    sampleAdded,
    dryRun,
  }
}
