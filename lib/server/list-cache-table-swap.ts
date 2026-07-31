/**
 * Build-then-swap helpers for list-cache tables.
 * Readers keep using the live table until a full rebuild finishes writing a
 * staging table; then we rename in one transaction so there is no empty window.
 */

import { query, withTransaction } from "@/lib/db"

const IDENT = /^[a-z_][a-z0-9_]*$/i

function assertIdent(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error(`invalid SQL identifier: ${name}`)
  }
  return name
}

/**
 * Ensure `table` has a PRIMARY KEY on `pkColumn`.
 * Needed because build-then-swap can leave a live table that was cloned from a
 * prior staging copy that never carried a PK (LIKE … INCLUDING CONSTRAINTS only
 * copies constraints that already exist). Without a PK, ON CONFLICT (pk) fails
 * with 42P10 — which surfaces as db_error on 在管产品 add.
 */
export async function ensureListCachePrimaryKey(
  table: string,
  pkColumn: string,
): Promise<void> {
  const t = assertIdent(table)
  const col = assertIdent(pkColumn)
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '${t}'::regclass
          AND contype = 'p'
      ) THEN
        ALTER TABLE ${t} ADD PRIMARY KEY (${col});
      END IF;
    END $$
  `)
}

/**
 * Drop + recreate an empty staging table cloned from the live cache schema.
 * Uses DEFAULTS + CONSTRAINTS (incl. PK) but not secondary indexes — callers
 * should create stable-named indexes on staging before swap.
 *
 * When `pkColumn` is set, always re-assert the primary key on staging so a live
 * table that lost its PK cannot permanently poison every subsequent rebuild.
 */
export async function prepareListCacheStagingTable(
  liveTable: string,
  stagingTable: string,
  pkColumn?: string,
): Promise<void> {
  const live = assertIdent(liveTable)
  const staging = assertIdent(stagingTable)
  await query(`DROP TABLE IF EXISTS ${staging}`)
  await query(
    `CREATE TABLE ${staging} (LIKE ${live} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
  )
  if (pkColumn) {
    await ensureListCachePrimaryKey(staging, pkColumn)
  }
}

/** Create indexes on a staging table (SQL must already target that table name). */
export async function createListCacheStagingIndexes(
  indexSqls: string[],
): Promise<void> {
  for (const sql of indexSqls) {
    await query(sql)
  }
}

/**
 * Atomically replace live with staging:
 *   live → *_swap_old, staging → live, drop *_swap_old
 * Concurrent SELECTs on `live` keep seeing the previous table until COMMIT.
 */
export async function atomicSwapListCacheTable(
  liveTable: string,
  stagingTable: string,
): Promise<void> {
  const live = assertIdent(liveTable)
  const staging = assertIdent(stagingTable)
  const old = assertIdent(`${live}_swap_old`)

  await withTransaction(async (tx) => {
    await tx(`DROP TABLE IF EXISTS ${old}`)
    await tx(`ALTER TABLE ${live} RENAME TO ${old}`)
    await tx(`ALTER TABLE ${staging} RENAME TO ${live}`)
    await tx(`DROP TABLE ${old}`)
  })
}
