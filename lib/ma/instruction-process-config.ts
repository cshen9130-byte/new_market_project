/**
 * Official instruction process configuration (per instruction type).
 * Persisted in localStorage — same client-side model as instruction records.
 */

import {
  INSTRUCTION_TYPE_OPTIONS,
  OFFICIAL_PROCESS_NODES,
  type InstructionTypeOption,
} from "@/lib/ma/instruction-roles"

export const INSTRUCTION_PROCESS_CONFIG_KEY = "ma_instruction_process_config_v1"
const CHANGE_EVENT = "ma-instruction-process-config-changed"

export type InstructionProcessTypeConfig = {
  /** When false, skip 总经理审批 in the official flow. Default true. */
  requireGmApproval: boolean
}

export type InstructionProcessConfig = Record<
  InstructionTypeOption,
  InstructionProcessTypeConfig
>

export const DEFAULT_INSTRUCTION_PROCESS_CONFIG: InstructionProcessConfig = {
  底层申赎类: { requireGmApproval: true },
  直投申赎类: { requireGmApproval: true },
  "入/出池审批": { requireGmApproval: true },
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function normalizeConfig(raw: unknown): InstructionProcessConfig {
  const base: InstructionProcessConfig = {
    底层申赎类: { ...DEFAULT_INSTRUCTION_PROCESS_CONFIG.底层申赎类 },
    直投申赎类: { ...DEFAULT_INSTRUCTION_PROCESS_CONFIG.直投申赎类 },
    "入/出池审批": { ...DEFAULT_INSTRUCTION_PROCESS_CONFIG["入/出池审批"] },
  }
  if (!raw || typeof raw !== "object") return base
  const obj = raw as Partial<Record<InstructionTypeOption, Partial<InstructionProcessTypeConfig>>>
  for (const type of INSTRUCTION_TYPE_OPTIONS) {
    const row = obj[type]
    if (row && typeof row.requireGmApproval === "boolean") {
      base[type] = { requireGmApproval: row.requireGmApproval }
    }
  }
  return base
}

let cachedConfig: InstructionProcessConfig | null = null

export function readInstructionProcessConfig(): InstructionProcessConfig {
  if (cachedConfig) return cachedConfig
  if (!canUseStorage()) {
    cachedConfig = { ...DEFAULT_INSTRUCTION_PROCESS_CONFIG }
    return cachedConfig
  }
  try {
    const raw = window.localStorage.getItem(INSTRUCTION_PROCESS_CONFIG_KEY)
    cachedConfig = normalizeConfig(raw ? JSON.parse(raw) : null)
  } catch {
    cachedConfig = {
      底层申赎类: { ...DEFAULT_INSTRUCTION_PROCESS_CONFIG.底层申赎类 },
      直投申赎类: { ...DEFAULT_INSTRUCTION_PROCESS_CONFIG.直投申赎类 },
      "入/出池审批": { ...DEFAULT_INSTRUCTION_PROCESS_CONFIG["入/出池审批"] },
    }
  }
  return cachedConfig
}

export function writeInstructionProcessConfig(
  next: InstructionProcessConfig,
): InstructionProcessConfig {
  const normalized = normalizeConfig(next)
  cachedConfig = normalized
  if (canUseStorage()) {
    window.localStorage.setItem(INSTRUCTION_PROCESS_CONFIG_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }
  return normalized
}

export function updateInstructionProcessTypeConfig(
  type: InstructionTypeOption,
  patch: Partial<InstructionProcessTypeConfig>,
): InstructionProcessConfig {
  const current = readInstructionProcessConfig()
  return writeInstructionProcessConfig({
    ...current,
    [type]: { ...current[type], ...patch },
  })
}

export function subscribeInstructionProcessConfig(listener: () => void): () => void {
  if (!canUseStorage()) return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === INSTRUCTION_PROCESS_CONFIG_KEY || e.key === null) {
      cachedConfig = null
      listener()
    }
  }
  const onLocal = () => {
    cachedConfig = null
    listener()
  }
  window.addEventListener("storage", onStorage)
  window.addEventListener(CHANGE_EVENT, onLocal)
  return () => {
    window.removeEventListener("storage", onStorage)
    window.removeEventListener(CHANGE_EVENT, onLocal)
  }
}

export function getInstructionProcessConfigSnapshot(): InstructionProcessConfig {
  return readInstructionProcessConfig()
}

export function getInstructionProcessConfigServerSnapshot(): InstructionProcessConfig {
  return DEFAULT_INSTRUCTION_PROCESS_CONFIG
}

/** Map runtime category → settings instruction type. */
export function instructionTypeOptionFromCategory(
  category: "underlying" | "direct" | "customer" | "pool" | string,
): InstructionTypeOption {
  if (category === "direct") return "直投申赎类"
  if (category === "pool") return "入/出池审批"
  return "底层申赎类"
}

export function requiresGmApprovalForType(
  type: InstructionTypeOption,
  config: InstructionProcessConfig = readInstructionProcessConfig(),
): boolean {
  return config[type]?.requireGmApproval !== false
}

/** Official node list for settings / diagrams, filtered by process config. */
export function getOfficialProcessNodes(
  type: InstructionTypeOption,
  config: InstructionProcessConfig = readInstructionProcessConfig(),
): string[] {
  const nodes = OFFICIAL_PROCESS_NODES[type]
  if (requiresGmApprovalForType(type, config)) return [...nodes]
  return nodes.filter((n) => n !== "总经理审批")
}
