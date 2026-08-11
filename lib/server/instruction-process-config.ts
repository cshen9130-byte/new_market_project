/**
 * Shared (team-wide) official instruction process configuration.
 * Singleton JSONB row — same pattern as due_diligence_team_table.
 */

import { query } from "@/lib/db"
import {
  DEFAULT_INSTRUCTION_PROCESS_CONFIG,
  normalizeInstructionProcessConfig,
  type InstructionProcessConfig,
} from "@/lib/ma/instruction-process-config"

const TEAM_ROW_ID = "team"

let initPromise: Promise<void> | null = null

function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = _ensureTable().catch((e) => {
      initPromise = null
      throw e
    })
  }
  return initPromise
}

async function _ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_instruction_process_config (
      id          TEXT PRIMARY KEY,
      config      JSONB NOT NULL DEFAULT '{}',
      updated_by  TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export type InstructionProcessConfigSnapshot = {
  config: InstructionProcessConfig
  updatedAt: string | null
  updatedBy: string
}

export async function getServerInstructionProcessConfig(): Promise<InstructionProcessConfigSnapshot> {
  await ensureTable()
  const rows = await query<{
    config: InstructionProcessConfig | string
    updated_by: string
    updated_at: string | Date | null
  }>(
    `SELECT config, updated_by, updated_at
       FROM ops_instruction_process_config
      WHERE id = $1
      LIMIT 1`,
    [TEAM_ROW_ID],
  )

  if (rows.length === 0) {
    return {
      config: normalizeInstructionProcessConfig(DEFAULT_INSTRUCTION_PROCESS_CONFIG),
      updatedAt: null,
      updatedBy: "",
    }
  }

  const row = rows[0]
  const raw =
    typeof row.config === "string"
      ? (() => {
          try {
            return JSON.parse(row.config) as unknown
          } catch {
            return null
          }
        })()
      : row.config

  const updatedAt =
    row.updated_at == null
      ? null
      : typeof row.updated_at === "string"
        ? row.updated_at
        : row.updated_at.toISOString()

  return {
    config: normalizeInstructionProcessConfig(raw),
    updatedAt,
    updatedBy: String(row.updated_by || ""),
  }
}

export async function saveServerInstructionProcessConfig(
  input: unknown,
  updatedBy: string,
): Promise<InstructionProcessConfigSnapshot> {
  await ensureTable()
  const config = normalizeInstructionProcessConfig(input)
  const actor = String(updatedBy || "").trim()

  const rows = await query<{
    config: InstructionProcessConfig | string
    updated_by: string
    updated_at: string | Date | null
  }>(
    `INSERT INTO ops_instruction_process_config (id, config, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       config = EXCLUDED.config,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING config, updated_by, updated_at`,
    [TEAM_ROW_ID, JSON.stringify(config), actor],
  )

  const row = rows[0]
  const updatedAt =
    row?.updated_at == null
      ? new Date().toISOString()
      : typeof row.updated_at === "string"
        ? row.updated_at
        : row.updated_at.toISOString()

  return {
    config,
    updatedAt,
    updatedBy: String(row?.updated_by || actor),
  }
}
