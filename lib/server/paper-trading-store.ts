import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import {
  parsePaperState,
  splitPaperState,
  type PaperScope,
  type PaperState,
} from "@/lib/client/paper-trading"
import { getServerStoragePath } from "@/lib/server/storage"

type StoredSlice = {
  updatedAt: string | null
  updatedBy: string | null
  state: PaperState
}

function storageDir() {
  return getServerStoragePath("paper-trading")
}

function teamFile() {
  return path.join(storageDir(), "team.json")
}

function mineFile(userId: string) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
  return path.join(storageDir(), "mine", `${safe || "unknown"}.json`)
}

function emptySlice(): StoredSlice {
  return { updatedAt: null, updatedBy: null, state: { portfolios: [], products: [], positions: [], strategies: [] } }
}

function tryParseSlice(raw: string): StoredSlice | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSlice> & Partial<PaperState>
    if (parsed && Array.isArray((parsed as StoredSlice).state?.portfolios)) {
      return {
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
        updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : null,
        state: parsePaperState((parsed as StoredSlice).state),
      }
    }
    if (parsed && Array.isArray(parsed.portfolios)) {
      return { ...emptySlice(), state: parsePaperState(parsed) }
    }
    return null
  } catch {
    return null
  }
}

function readSlice(file: string): StoredSlice {
  for (const candidate of [file, `${file}.bak`]) {
    if (!existsSync(candidate)) continue
    const parsed = tryParseSlice(readFileSync(candidate, "utf-8"))
    if (parsed) return parsed
  }
  return emptySlice()
}

function writeSlice(file: string, slice: StoredSlice) {
  mkdirSync(path.dirname(file), { recursive: true })
  const json = JSON.stringify(slice, null, 2)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, json, "utf-8")
  if (existsSync(file)) {
    try {
      copyFileSync(file, `${file}.bak`)
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
}

function persistableSlice(state: PaperState, scope: PaperScope): PaperState {
  const split = splitPaperState(parsePaperState(state))
  return scope === "team" ? split.team : split.mine
}

function mergeTeamWrite(existing: PaperState, incoming: PaperState, knownIds: string[]): PaperState {
  const incomingById = new Map(incoming.portfolios.map((p) => [p.id, p]))
  const known = new Set(knownIds)
  const extra = existing.portfolios.filter((p) => !incomingById.has(p.id) && !known.has(p.id))
  const portfolios = [...incoming.portfolios, ...extra]
  const keepIds = new Set(portfolios.map((p) => p.id))
  const take = <T extends { portfolioId: string }>(primary: T[], fallback: T[]) => [
    ...primary.filter((row) => incomingById.has(row.portfolioId)),
    ...fallback.filter((row) => keepIds.has(row.portfolioId) && !incomingById.has(row.portfolioId)),
  ]
  return {
    portfolios,
    products: take(incoming.products, existing.products),
    positions: take(incoming.positions, existing.positions),
    strategies: take(incoming.strategies, existing.strategies),
  }
}

export function readTeamPaperState(): PaperState {
  return persistableSlice(readSlice(teamFile()).state, "team")
}

export function readMinePaperState(userId: string): PaperState {
  if (!userId.trim()) return emptySlice().state
  return persistableSlice(readSlice(mineFile(userId)).state, "mine")
}

export function writeTeamPaperState(state: PaperState, userId: string, knownIds?: string[]) {
  const incoming = persistableSlice(state, "team")
  const existing = readTeamPaperState()
  const merged = Array.isArray(knownIds) ? mergeTeamWrite(existing, incoming, knownIds) : incoming
  writeSlice(teamFile(), {
    updatedAt: new Date().toISOString(),
    updatedBy: userId || null,
    state: merged,
  })
}

export function writeMinePaperState(state: PaperState, userId: string) {
  if (!userId.trim()) throw new Error("missing_user")
  writeSlice(mineFile(userId), {
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
    state: persistableSlice(state, "mine"),
  })
}
