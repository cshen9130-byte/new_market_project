/**
 * POST /api/knowledge-base/migrate-to-pg
 *
 * One-time migration: reads existing JSON disk index files from kb_index/
 * and imports their embeddings into the PostgreSQL kb_chunks table.
 *
 * Also migrates kb_graph_index/ and kb_llm_entities/ JSON files.
 *
 * Safe to run multiple times — chunks are upserted (delete-then-insert per source).
 * Requires admin role.
 */

import { NextResponse } from "next/server"
import { existsSync, readdirSync, readFileSync } from "fs"
import path from "path"
import { getUserById } from "@/lib/server/users"
import { getServerStoragePath } from "@/lib/server/storage"
import {
  pgEnsureSchema,
  pgUpsertFileChunks,
  pgSaveBm25Index,
  pgSaveGraphIndex,
  pgSaveLLMEntityEntries,
  type MemoryVectorRow,
  type FileFingerprint,
} from "@/lib/server/knowledge-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Disk index types (legacy format, read-only) ───────────────────────────────

type LegacyDiskEntry = {
  version?: number
  scope?: string
  model?: string
  files?: Record<string, FileFingerprint>
  indexedDocuments?: number
  indexedChunks?: number
  memoryVectors?: MemoryVectorRow[]
  bm25Index?: Record<string, unknown>
  signature?: string
  updatedAt?: string
}

type LegacyGraphEntry = {
  version?: number
  signature?: string
  termChunks?: Record<string, unknown>
  chunkTerms?: unknown[]
  numChunks?: number
  updatedAt?: string
}

type LegacyLLMEntityEntry = {
  version?: number
  scope?: string
  files?: Record<string, { size: number; updatedAt: string; entities: unknown }>
  updatedAt?: string
}

// ── Migration logic ───────────────────────────────────────────────────────────

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

async function migrateChunkIndex(
  log: string[],
): Promise<{ files: number; chunks: number }> {
  const indexDir = getServerStoragePath("kb_index")
  const jsonFiles = listJsonFiles(indexDir)

  let totalFiles = 0
  let totalChunks = 0

  for (const jsonPath of jsonFiles) {
    const data = readJsonFile(jsonPath) as LegacyDiskEntry | null
    if (!data) continue

    // Normalise legacy v1 format (single signature, no files map)
    const scope = data.scope ?? ""
    const model = data.model ?? process.env.DASHSCOPE_EMBEDDING_MODEL ?? "text-embedding-v4"
    const filesMap: Record<string, FileFingerprint> = data.files ?? {}
    const vectors: MemoryVectorRow[] = data.memoryVectors ?? []

    if (!vectors.length) continue

    // Group vectors by source file
    const bySource = new Map<string, MemoryVectorRow[]>()
    for (const row of vectors) {
      const src = String(row?.metadata?.source || "")
      if (!src) continue
      const list = bySource.get(src) ?? []
      list.push(row)
      bySource.set(src, list)
    }

    for (const [source, rows] of bySource) {
      const fp: FileFingerprint = filesMap[source] ?? {
        size: Number((rows[0]?.metadata as any)?.size ?? 0),
        updatedAt: String((rows[0]?.metadata as any)?.updatedAt ?? ""),
      }
      try {
        await pgUpsertFileChunks(scope, source, rows, fp, model)
        totalFiles++
        totalChunks += rows.length
      } catch (err: any) {
        log.push(`  ⚠ Failed to upsert ${source}: ${err?.message ?? err}`)
      }
    }

    // Migrate BM25 index if present
    if (data.bm25Index && typeof data.bm25Index === "object") {
      try {
        await pgSaveBm25Index(scope, data.bm25Index as Parameters<typeof pgSaveBm25Index>[1])
      } catch {
        // non-fatal
      }
    }
  }

  return { files: totalFiles, chunks: totalChunks }
}

async function migrateGraphIndex(log: string[]): Promise<number> {
  const graphDir = getServerStoragePath("kb_graph_index")
  const jsonFiles = listJsonFiles(graphDir)
  let count = 0

  // The graph index files don't encode the scope in their filename.
  // We try to infer scope from the data's embedded fields, but we don't always have it.
  // For now, import what we can.
  for (const jsonPath of jsonFiles) {
    const data = readJsonFile(jsonPath) as LegacyGraphEntry | null
    if (!data || data.version !== 1 || !data.termChunks) continue
    // Graph index files don't store scope — they're keyed by the cache hash.
    // We can't reliably recover the scope so skip them; they'll rebuild on next query.
    log.push(`  ℹ Skipping graph index ${path.basename(jsonPath)} (will rebuild automatically)`)
    count++
  }

  return count
}

async function migrateLLMEntities(log: string[]): Promise<number> {
  const entityDir = getServerStoragePath("kb_llm_entities")
  const jsonFiles = listJsonFiles(entityDir)
  let count = 0

  for (const jsonPath of jsonFiles) {
    const data = readJsonFile(jsonPath) as LegacyLLMEntityEntry | null
    if (!data || data.version !== 1 || !data.files) continue
    const scope = data.scope ?? ""
    const entries: Record<string, { size: number; updatedAt: string; entities: unknown }> = {}
    for (const [source, entry] of Object.entries(data.files)) {
      entries[source] = { size: entry.size, updatedAt: entry.updatedAt, entities: entry.entities }
    }
    try {
      await pgSaveLLMEntityEntries(scope, entries)
      count += Object.keys(entries).length
    } catch (err: any) {
      log.push(`  ⚠ Failed to migrate LLM entities from ${path.basename(jsonPath)}: ${err?.message ?? err}`)
    }
  }

  return count
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user || user.role !== "admin") {
      return NextResponse.json({ ok: false, error: "需要管理员权限" }, { status: 403 })
    }

    const log: string[] = []

    log.push("Ensuring PG schema...")
    await pgEnsureSchema()
    log.push("Schema ready.")

    log.push("Migrating chunk embeddings from kb_index/...")
    const { files, chunks } = await migrateChunkIndex(log)
    log.push(`Migrated ${files} source files (${chunks} chunks) into kb_chunks.`)

    log.push("Checking graph index files...")
    const graphCount = await migrateGraphIndex(log)
    log.push(`Found ${graphCount} graph index file(s) — they will rebuild automatically.`)

    log.push("Migrating LLM entity cache from kb_llm_entities/...")
    const entityCount = await migrateLLMEntities(log)
    log.push(`Migrated ${entityCount} entity cache entries into kb_llm_entities.`)

    log.push("Migration complete.")

    return NextResponse.json({ ok: true, log })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 },
    )
  }
}
