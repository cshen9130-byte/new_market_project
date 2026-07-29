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
 * Drop + recreate an empty staging table cloned from the live cache schema.
 * Uses DEFAULTS + CONSTRAINTS (incl. PK) but not secondary indexes — callers
 * should create stable-named indexes on staging before swap.
 */
export async function prepareListCacheStagingTable(
  liveTable: string,
  stagingTable: string,
): Promise<void> {
  const live = assertIdent(liveTable)
  const staging = assertIdent(stagingTable)
  await query(`DROP TABLE IF EXISTS ${staging}`)
  await query(
    `CREATE TABLE ${staging} (LIKE ${live} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
  )
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
