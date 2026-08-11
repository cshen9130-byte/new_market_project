/**
 * Official instruction process configuration (per instruction type).
 * Shared via server (ops_instruction_process_config); localStorage is a cache only.
 */

import {
  INSTRUCTION_TYPE_OPTIONS,
  OFFICIAL_PROCESS_NODES,
  type InstructionTypeOption,
} from "@/lib/ma/instruction-roles"

export const INSTRUCTION_PROCESS_CONFIG_KEY = "ma_instruction_process_config_v1"
const CHANGE_EVENT = "ma-instruction-process-config-changed"
const API_PATH = "/ma/api/instructions/process-config"

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

export function normalizeInstructionProcessConfig(raw: unknown): InstructionProcessConfig {
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
let hydratePromise: Promise<void> | null = null
let lastHydrateError: string | null = null

export function getInstructionProcessConfigHydrateError(): string | null {
  return lastHydrateError
}

function currentUserId(): string {
  if (!canUseStorage()) return ""
  try {
    const raw = window.localStorage.getItem("currentUser")
    if (!raw) return ""
    const id = (JSON.parse(raw) as { id?: unknown })?.id
    return typeof id === "string" ? id.trim() : ""
  } catch {
    return ""
  }
}

function authHeaders(): HeadersInit {
  const uid = currentUserId()
  return uid ? { "x-market-user-id": uid } : {}
}

async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || res.statusText || "请求失败")
  }
  return data as T
}

export function readInstructionProcessConfig(): InstructionProcessConfig {
  if (cachedConfig) return cachedConfig
  if (!canUseStorage()) {
    cachedConfig = normalizeInstructionProcessConfig(DEFAULT_INSTRUCTION_PROCESS_CONFIG)
    return cachedConfig
  }
  try {
    const raw = window.localStorage.getItem(INSTRUCTION_PROCESS_CONFIG_KEY)
    cachedConfig = normalizeInstructionProcessConfig(raw ? JSON.parse(raw) : null)
  } catch {
    cachedConfig = normalizeInstructionProcessConfig(DEFAULT_INSTRUCTION_PROCESS_CONFIG)
  }
  return cachedConfig
}

/** Apply config locally (memory + localStorage cache) and notify subscribers. */
export function writeInstructionProcessConfig(
  next: InstructionProcessConfig,
): InstructionProcessConfig {
  const normalized = normalizeInstructionProcessConfig(next)
  cachedConfig = normalized
  if (canUseStorage()) {
    window.localStorage.setItem(INSTRUCTION_PROCESS_CONFIG_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }
  return normalized
}

/**
 * Pull shared process config from the server (source of truth).
 * Safe to call repeatedly; concurrent callers share one in-flight promise.
 */
export function ensureInstructionProcessConfigHydrated(): Promise<void> {
  if (!canUseStorage()) return Promise.resolve()
  if (hydratePromise) return hydratePromise

  hydratePromise = (async () => {
    try {
      const data = await apiFetch<{
        ok: true
        config: InstructionProcessConfig
      }>(API_PATH)
      writeInstructionProcessConfig(data.config)
      lastHydrateError = null
    } catch (e) {
      lastHydrateError = e instanceof Error ? e.message : "审批流程配置同步失败"
      // Keep local cache so the page still renders.
      if (canUseStorage()) {
        window.dispatchEvent(new Event(CHANGE_EVENT))
      }
    } finally {
      hydratePromise = null
    }
  })()

  return hydratePromise
}

/**
 * Patch one instruction type and persist to the shared server store (admin only).
 */
export async function updateInstructionProcessTypeConfig(
  type: InstructionTypeOption,
  patch: Partial<InstructionProcessTypeConfig>,
): Promise<InstructionProcessConfig> {
  const current = readInstructionProcessConfig()
  const next = normalizeInstructionProcessConfig({
    ...current,
    [type]: { ...current[type], ...patch },
  })
  const data = await apiFetch<{ ok: true; config: InstructionProcessConfig }>(API_PATH, {
    method: "PUT",
    body: JSON.stringify({ config: next }),
  })
  return writeInstructionProcessConfig(data.config)
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
