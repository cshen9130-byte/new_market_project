/**
 * PostgreSQL persistence layer for the knowledge base.
 *
 * Replaces all JSON disk-file storage with PG tables:
 *   kb_chunks       — text chunks + 1024-dim pgvector embeddings
 *   kb_bm25_index   — pre-built BM25 inverted index (JSONB blob, per scope)
 *   kb_graph_index  — term co-occurrence graph index (JSONB blob, per scope)
 *   kb_llm_entities — LLM-extracted entity cache (per file per scope)
 *
 * Schema is bootstrapped lazily on first use.
 * Run scripts/kb_pg_schema.sql once to ensure indexes (incl. HNSW) are created.
 */

import { query as dbQuery, rawQuery } from "@/lib/db"

// ── Shared types ──────────────────────────────────────────────────────────────

export type FileFingerprint = {
  size: number
  updatedAt: string
}

export type MemoryVectorRow = {
  content: string
  embedding: number[]
  metadata: Record<string, unknown>
}

export type Bm25PreIndex = {
  /** term → list of docIndices that contain the term */
  postings: Record<string, number[]>
  /** docIdx → { term → raw TF count } */
  docTermFreqs: Record<string, number>[]
  /** docIdx → total term count */
  docLengths: number[]
  /** average document length across all docs */
  avgdl: number
}

export type GraphIndex = {
  version: 1
  signature: string
  /** term → list of chunk indices that contain it */
  termChunks: Record<string, number[]>
  /** chunk index → relevant terms for graph linking (IDF-filtered) */
  chunkTerms: string[][]
  numChunks: number
  updatedAt: string
}

export type LLMEntityCacheRow = {
  source: string
  size: number
  updatedAt: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: any
}

export const EMPTY_BM25_INDEX: Bm25PreIndex = {
  postings: {},
  docTermFreqs: [],
  docLengths: [],
  avgdl: 0,
}

export const EMPTY_GRAPH_INDEX: GraphIndex = {
  version: 1,
  signature: "",
  termChunks: {},
  chunkTerms: [],
  numChunks: 0,
  updatedAt: "",
}

// ── Scale thresholds ──────────────────────────────────────────────────────────

/**
 * Max chunks before switching from in-RAM MemoryVectorStore to PG HNSW search.
 * Above this, embedding vectors are NOT loaded into Node.js memory.
 */
export const PG_VECTOR_IN_MEM_MAX = Number(process.env.KB_VECTOR_IN_MEM_MAX ?? 20_000)

/** Max chunks before skipping BM25 index build/load. */
export const PG_BM25_MAX = Number(process.env.KB_BM25_MAX ?? 50_000)

/** Max chunks before skipping graph RAG index build/load. */
export const PG_GRAPH_MAX = Number(process.env.KB_GRAPH_MAX ?? 30_000)

// ── Schema bootstrapping ──────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var _kbPgSchemaReady: boolean | undefined
}

/**
 * Idempotently creates all kb_* tables if they don't exist.
 * Called at the start of every PG helper; subsequent calls return immediately.
 * Note: the HNSW index creation is attempted but silently skipped on failure
 * (e.g. table already has many rows — create it manually with CONCURRENTLY then).
 */
export async function pgEnsureSchema(): Promise<void> {
  if (globalThis._kbPgSchemaReady) return
  try {
    await rawQuery(`CREATE EXTENSION IF NOT EXISTS vector`)

    await rawQuery(`
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id              BIGSERIAL PRIMARY KEY,
        scope           TEXT NOT NULL DEFAULT '',
        source          TEXT NOT NULL,
        content         TEXT NOT NULL,
        embedding       vector(1024),
        metadata        JSONB NOT NULL DEFAULT '{}',
        file_size       BIGINT NOT NULL DEFAULT 0,
        file_updated_at TEXT NOT NULL DEFAULT '',
        model           TEXT NOT NULL DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    await rawQuery(`
      CREATE INDEX IF NOT EXISTS kb_chunks_scope_source ON kb_chunks (scope, source)
    `)
    await rawQuery(`
      CREATE INDEX IF NOT EXISTS kb_chunks_scope ON kb_chunks (scope)
    `)

    // HNSW index — silently skip if it can't be created inline (e.g. large existing table)
    await rawQuery(`
      CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
        ON kb_chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `).catch((e) => {
      console.warn("[knowledge-pg] HNSW index creation skipped:", (e as Error).message)
    })

    await rawQuery(`
      CREATE TABLE IF NOT EXISTS kb_bm25_index (
        scope      TEXT PRIMARY KEY,
        index_data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    await rawQuery(`
      CREATE TABLE IF NOT EXISTS kb_graph_index (
        scope      TEXT PRIMARY KEY,
        signature  TEXT NOT NULL DEFAULT '',
        index_data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    await rawQuery(`
      CREATE TABLE IF NOT EXISTS kb_llm_entities (
        scope           TEXT NOT NULL,
        source          TEXT NOT NULL,
        file_size       BIGINT NOT NULL DEFAULT 0,
        file_updated_at TEXT NOT NULL DEFAULT '',
        entities        JSONB NOT NULL,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, source)
      )
    `)

    globalThis._kbPgSchemaReady = true
  } catch (err) {
    console.error("[knowledge-pg] Schema setup failed:", err)
    throw err
  }
}

// ── Vector format helpers ─────────────────────────────────────────────────────

/** Serialize a number[] to the `[x,y,...]` string format pgvector expects. */
export function vecToString(v: number[]): string {
  return `[${v.join(",")}]`
}

/** Parse the pgvector string `[x,y,...]` returned by pg into a number[]. */
function parseVec(v: unknown): number[] {
  if (!v) return []
  const s = String(v)
  if (!s || s === "[]") return []
  return s
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number)
}

// ── Chunk CRUD ────────────────────────────────────────────────────────────────

/** Load file fingerprints (size + updatedAt) for all distinct sources in a scope. */
export async function pgLoadFingerprints(scope: string): Promise<Record<string, FileFingerprint>> {
  await pgEnsureSchema()
  const rows = await dbQuery<{ source: string; file_size: string; file_updated_at: string }>(
    `SELECT DISTINCT ON (source) source, file_size, file_updated_at
       FROM kb_chunks WHERE scope = $1`,
    [scope],
  )
  const map: Record<string, FileFingerprint> = {}
  for (const row of rows) {
    map[row.source] = { size: Number(row.file_size), updatedAt: row.file_updated_at }
  }
  return map
}

/** Count total chunks in a scope. */
export async function pgCountChunks(scope: string): Promise<number> {
  await pgEnsureSchema()
  const rows = await dbQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM kb_chunks WHERE scope = $1`,
    [scope],
  )
  return Number(rows[0]?.n ?? 0)
}

/**
 * Load all rows for a scope.
 * Pass `{ includeEmbeddings: false }` to skip loading vector data (saves RAM for BM25/Graph).
 */
export async function pgLoadRows(
  scope: string,
  opts?: { includeEmbeddings?: boolean },
): Promise<MemoryVectorRow[]> {
  await pgEnsureSchema()
  const withVec = opts?.includeEmbeddings !== false
  const cols = withVec ? "content, metadata, embedding" : "content, metadata"
  const rows = await dbQuery<{ content: string; metadata: Record<string, unknown>; embedding?: unknown }>(
    `SELECT ${cols} FROM kb_chunks WHERE scope = $1 ORDER BY id`,
    [scope],
  )
  return rows.map((r) => ({
    content: r.content,
    embedding: withVec ? parseVec(r.embedding) : [],
    metadata: r.metadata ?? {},
  }))
}

/** Delete all chunks for specific source files in a scope. */
export async function pgDeleteChunksBySource(scope: string, sources: string[]): Promise<void> {
  if (!sources.length) return
  await pgEnsureSchema()
  await rawQuery(
    `DELETE FROM kb_chunks WHERE scope = $1 AND source = ANY($2::text[])`,
    [scope, sources],
  )
}

/**
 * Delete all chunks for a scope.
 * Pass `undefined` / `null` to delete ALL chunks across every scope.
 */
export async function pgDeleteScopeChunks(scope?: string | null): Promise<void> {
  await pgEnsureSchema()
  if (scope == null) {
    await rawQuery(`DELETE FROM kb_chunks`)
  } else {
    await rawQuery(`DELETE FROM kb_chunks WHERE scope = $1`, [scope])
  }
}

const CHUNK_INSERT_BATCH = 500

/**
 * Upsert all chunks for one source file: deletes existing rows then inserts new ones.
 * Uses batched inserts to stay within PG's 65 535-parameter limit.
 */
export async function pgUpsertFileChunks(
  scope: string,
  source: string,
  rows: MemoryVectorRow[],
  fp: FileFingerprint,
  model: string,
): Promise<void> {
  await pgEnsureSchema()
  await rawQuery(
    `DELETE FROM kb_chunks WHERE scope = $1 AND source = $2`,
    [scope, source],
  )
  if (!rows.length) return

  for (let start = 0; start < rows.length; start += CHUNK_INSERT_BATCH) {
    const batch = rows.slice(start, start + CHUNK_INSERT_BATCH)
    const values: unknown[] = []
    const placeholders: string[] = []
    let idx = 1
    for (const row of batch) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}::vector, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      )
      values.push(
        scope,
        source,
        row.content,
        vecToString(row.embedding),
        row.metadata,
        fp.size,
        fp.updatedAt,
        model,
      )
    }
    await rawQuery(
      `INSERT INTO kb_chunks
         (scope, source, content, embedding, metadata, file_size, file_updated_at, model)
       VALUES ${placeholders.join(",")}`,
      values,
    )
  }
}

/** PG HNSW cosine-similarity search. Returns top-k chunks closest to the query vector. */
export async function pgVectorSearch(
  scope: string,
  queryVector: number[],
  topK: number,
): Promise<Array<{ content: string; metadata: Record<string, unknown>; score: number }>> {
  await pgEnsureSchema()
  const rows = await dbQuery<{ content: string; metadata: Record<string, unknown>; score: string }>(
    `SELECT content, metadata, (1 - (embedding <=> $1::vector)) AS score
       FROM kb_chunks
      WHERE scope = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [vecToString(queryVector), scope, topK],
  )
  return rows.map((r) => ({
    content: r.content,
    metadata: r.metadata ?? {},
    score: parseFloat(r.score),
  }))
}

/** Return index metadata for a scope without loading any vector data. */
export async function pgGetIndexInfo(scope: string): Promise<{
  exists: boolean
  indexedDocuments: number
  indexedChunks: number
  updatedAt: string | null
  model: string | null
  indexedFiles: string[]
}> {
  await pgEnsureSchema()

  // Get overall stats
  const stats = await dbQuery<{ n: string; updated_at: string; model: string }>(
    `SELECT COUNT(*) AS n, MAX(created_at)::text AS updated_at, MIN(model) AS model
       FROM kb_chunks WHERE scope = $1`,
    [scope],
  )
  const total = Number(stats[0]?.n ?? 0)
  if (!total) {
    return { exists: false, indexedDocuments: 0, indexedChunks: 0, updatedAt: null, model: null, indexedFiles: [] }
  }

  // Get distinct source list
  const sources = await dbQuery<{ source: string }>(
    `SELECT DISTINCT source FROM kb_chunks WHERE scope = $1 ORDER BY source`,
    [scope],
  )

  return {
    exists: true,
    indexedDocuments: sources.length,
    indexedChunks: total,
    updatedAt: stats[0]?.updated_at ?? null,
    model: stats[0]?.model ?? null,
    indexedFiles: sources.map((r) => r.source),
  }
}

// ── BM25 index ────────────────────────────────────────────────────────────────

export async function pgLoadBm25Index(scope: string): Promise<Bm25PreIndex | null> {
  await pgEnsureSchema()
  const rows = await dbQuery<{ index_data: Bm25PreIndex }>(
    `SELECT index_data FROM kb_bm25_index WHERE scope = $1`,
    [scope],
  )
  return rows[0]?.index_data ?? null
}

export async function pgSaveBm25Index(scope: string, index: Bm25PreIndex): Promise<void> {
  await pgEnsureSchema()
  await rawQuery(
    `INSERT INTO kb_bm25_index (scope, index_data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (scope) DO UPDATE SET index_data = $2, updated_at = now()`,
    [scope, index],
  )
}

export async function pgDeleteBm25Index(scope?: string | null): Promise<void> {
  await pgEnsureSchema()
  if (scope == null) {
    await rawQuery(`DELETE FROM kb_bm25_index`)
  } else {
    await rawQuery(`DELETE FROM kb_bm25_index WHERE scope = $1`, [scope])
  }
}

// ── Graph index ───────────────────────────────────────────────────────────────

export async function pgLoadGraphIndex(scope: string): Promise<GraphIndex | null> {
  await pgEnsureSchema()
  const rows = await dbQuery<{ index_data: GraphIndex }>(
    `SELECT index_data FROM kb_graph_index WHERE scope = $1`,
    [scope],
  )
  const data = rows[0]?.index_data
  if (!data || data.version !== 1) return null
  return data
}

export async function pgSaveGraphIndex(scope: string, index: GraphIndex): Promise<void> {
  await pgEnsureSchema()
  await rawQuery(
    `INSERT INTO kb_graph_index (scope, signature, index_data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (scope) DO UPDATE SET signature = $2, index_data = $3, updated_at = now()`,
    [scope, index.signature, index],
  )
}

export async function pgDeleteGraphIndex(scope?: string | null): Promise<void> {
  await pgEnsureSchema()
  if (scope == null) {
    await rawQuery(`DELETE FROM kb_graph_index`)
  } else {
    await rawQuery(`DELETE FROM kb_graph_index WHERE scope = $1`, [scope])
  }
}

// ── LLM entity cache ──────────────────────────────────────────────────────────

/** Load all LLM entity cache entries for a scope, keyed by source path. */
export async function pgLoadLLMEntityCache(scope: string): Promise<Record<string, LLMEntityCacheRow>> {
  await pgEnsureSchema()
  const rows = await dbQuery<{
    source: string
    file_size: string
    file_updated_at: string
    entities: LLMEntityCacheRow["entities"]
  }>(
    `SELECT source, file_size, file_updated_at, entities
       FROM kb_llm_entities WHERE scope = $1`,
    [scope],
  )
  const map: Record<string, LLMEntityCacheRow> = {}
  for (const row of rows) {
    map[row.source] = {
      source: row.source,
      size: Number(row.file_size),
      updatedAt: row.file_updated_at,
      entities: row.entities,
    }
  }
  return map
}

/** Upsert a batch of entity cache entries for a scope. */
export async function pgSaveLLMEntityEntries(
  scope: string,
  entries: Record<string, { size: number; updatedAt: string; entities: unknown }>,
): Promise<void> {
  await pgEnsureSchema()
  for (const [source, entry] of Object.entries(entries)) {
    await rawQuery(
      `INSERT INTO kb_llm_entities (scope, source, file_size, file_updated_at, entities, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (scope, source) DO UPDATE
           SET file_size = $3, file_updated_at = $4, entities = $5, updated_at = now()`,
      [scope, source, entry.size, entry.updatedAt, entry.entities],
    )
  }
}

/** Delete LLM entity cache for a scope. Pass `null` to wipe all scopes. */
export async function pgDeleteLLMEntityCache(scope?: string | null): Promise<void> {
  await pgEnsureSchema()
  if (scope == null) {
    await rawQuery(`DELETE FROM kb_llm_entities`)
  } else {
    await rawQuery(`DELETE FROM kb_llm_entities WHERE scope = $1`, [scope])
  }
}
