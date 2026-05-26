-- ============================================================
-- Knowledge-base vector storage schema for PostgreSQL + pgvector
-- Run this once against your database before starting the app.
--
-- Requirements:
--   pgvector extension: https://github.com/pgvector/pgvector
--   Ubuntu/Debian:  apt install postgresql-<ver>-pgvector
--   macOS (brew):   brew install pgvector
--   Docker:         use pgvector/pgvector image
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Chunk storage (text + 1024-dim embeddings) ───────────────────────────────
CREATE TABLE IF NOT EXISTS kb_chunks (
  id              BIGSERIAL PRIMARY KEY,
  scope           TEXT NOT NULL DEFAULT '',        -- folder path relative to KB root; '' = root
  source          TEXT NOT NULL,                    -- relative file path within the scope
  content         TEXT NOT NULL,
  embedding       vector(1024),
  metadata        JSONB NOT NULL DEFAULT '{}',
  file_size       BIGINT NOT NULL DEFAULT 0,
  file_updated_at TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_chunks_scope_source ON kb_chunks (scope, source);
CREATE INDEX IF NOT EXISTS kb_chunks_scope        ON kb_chunks (scope);

-- HNSW approximate nearest-neighbour index.
-- NOTE: building HNSW on a table with many existing rows is CPU-intensive.
-- If the table already has data, run this outside a transaction with CONCURRENTLY:
--   CREATE INDEX CONCURRENTLY kb_chunks_embedding_hnsw
--     ON kb_chunks USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
  ON kb_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── BM25 pre-computed inverted index (per scope) ─────────────────────────────
CREATE TABLE IF NOT EXISTS kb_bm25_index (
  scope      TEXT PRIMARY KEY,
  index_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Graph RAG term co-occurrence index (per scope) ───────────────────────────
CREATE TABLE IF NOT EXISTS kb_graph_index (
  scope      TEXT PRIMARY KEY,
  signature  TEXT NOT NULL DEFAULT '',
  index_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── LLM entity extraction cache (per file per scope) ─────────────────────────
-- Avoids re-calling the LLM for files that haven't changed.
CREATE TABLE IF NOT EXISTS kb_llm_entities (
  scope           TEXT NOT NULL,
  source          TEXT NOT NULL,
  file_size       BIGINT NOT NULL DEFAULT 0,
  file_updated_at TEXT NOT NULL DEFAULT '',
  entities        JSONB NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, source)
);
