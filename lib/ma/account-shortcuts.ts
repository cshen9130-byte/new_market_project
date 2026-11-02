export const ACCOUNT_SHORTCUTS_EVENT = "ma-account-shortcuts"
export const SHORTCUT_CAPTURE_ATTR = "data-ma-shortcut-capture"

export type AccountShortcut = {
  id: string
  combo: string
  href: string
  label: string
  newTab: boolean
}

export const REALTIME_QUOTES_HREF = "/ma/dashboard/realtime-quotes"
export const PRO_TRADING_HREF = "/ma/dashboard/realtime-quotes?view=pro"

export const DEFAULT_ACCOUNT_SHORTCUTS: AccountShortcut[] = [
  {
    id: "sc_realtime",
    combo: "ctrl+alt+t",
    href: PRO_TRADING_HREF,
    label: "专业交易",
    newTab: true,
  },
]

const RESERVED_COMBOS = new Set([
  "ctrl+a",
  "ctrl+c",
  "ctrl+f",
  "ctrl+h",
  "ctrl+j",
  "ctrl+l",
  "ctrl+n",
  "ctrl+p",
  "ctrl+r",
  "ctrl+s",
  "ctrl+v",
  "ctrl+w",
  "ctrl+x",
  "ctrl+y",
  "ctrl+z",
  "ctrl+0",
  "ctrl+minus",
  "ctrl+plus",
  "ctrl+shift+c",
  "ctrl+shift+i",
  "ctrl+shift+j",
  "ctrl+shift+n",
  "ctrl+shift+t",
  "ctrl+shift+w",
  "alt+d",
  "alt+f4",
])

const MOD_ORDER = ["ctrl", "alt", "shift"] as const

export function isReservedShortcutCombo(combo: string): boolean {
  return RESERVED_COMBOS.has(combo)
}

export function canonicalizeShortcutCombo(raw: string): string | null {
  const parts = raw
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
  const mods: string[] = []
  let key = ""
  for (const part of parts) {
    if (part === "control" || part === "ctrl" || part === "meta" || part === "cmd" || part === "command") {
      if (!mods.includes("ctrl")) mods.push("ctrl")
      continue
    }
    if (part === "alt" || part === "option") {
      if (!mods.includes("alt")) mods.push("alt")
      continue
    }
    if (part === "shift") {
      if (!mods.includes("shift")) mods.push("shift")
      continue
    }
    if (!key) key = part === " " || part === "spacebar" ? "space" : part
  }
  if (!/^[a-z0-9]$/.test(key) && !/^f(?:[1-9]|1[0-2])$/.test(key)) return null
  const ordered = MOD_ORDER.filter((mod) => mods.includes(mod))
  if (!ordered.includes("ctrl") && !ordered.includes("alt")) return null
  const combo = [...ordered, key].join("+")
  if (RESERVED_COMBOS.has(combo)) return null
  return combo
}

export function formatShortcutCombo(combo: string): string {
  return combo
    .split("+")
    .filter(Boolean)
    .map((part) => {
      if (part === "ctrl") return "Ctrl"
      if (part === "alt") return "Alt"
      if (part === "shift") return "Shift"
      if (part.length === 1) return part.toUpperCase()
      return part.toUpperCase()
    })
    .join(" + ")
}

export function shortcutComboFromEvent(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing">): string | null {
  if (event.repeat || event.isComposing) return null
  const raw = event.key
  if (!raw || raw === "Control" || raw === "Alt" || raw === "Shift" || raw === "Meta") return null
  const mods: string[] = []
  if (event.ctrlKey || event.metaKey) mods.push("ctrl")
  if (event.altKey) mods.push("alt")
  if (event.shiftKey) mods.push("shift")
  if (mods.length === 0) return null
  return canonicalizeShortcutCombo([...mods, raw].join("+"))
}

export function isSafeShortcutHref(href: string): boolean {
  if (typeof href !== "string" || href.length === 0 || href.length > 300) return false
  if (!href.startsWith("/ma/dashboard")) return false
  if (href.includes("://") || href.startsWith("//") || href.includes("\\") || href.includes("..")) return false
  return true
}

export function createAccountShortcutId(): string {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `sc_${stamp}${rand}`.slice(0, 40)
}

function cleanShortcutId(raw: unknown, index: number, used: Set<string>): string {
  let id = typeof raw === "string" ? raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) : ""
  if (!id) id = `sc_${index + 1}`
  while (used.has(id)) id = `${id.slice(0, 34)}_${used.size}`.slice(0, 40)
  used.add(id)
  return id
}

export function normalizeAccountShortcuts(raw: unknown): AccountShortcut[] {
  if (!Array.isArray(raw)) return DEFAULT_ACCOUNT_SHORTCUTS.map((item) => ({ ...item }))
  const usedIds = new Set<string>()
  const usedCombos = new Set<string>()
  const shortcuts: AccountShortcut[] = []
  for (const item of raw) {
    if (shortcuts.length >= 20) break
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const combo = typeof record.combo === "string" ? canonicalizeShortcutCombo(record.combo) : null
    if (!combo || usedCombos.has(combo)) continue
    const href = typeof record.href === "string" ? record.href.trim() : ""
    if (!isSafeShortcutHref(href)) continue
    const labelSource = typeof record.label === "string" ? record.label.replace(/\s+/g, " ").trim() : ""
    const label = (labelSource || "页面").slice(0, 40)
    usedCombos.add(combo)
    shortcuts.push({
      id: cleanShortcutId(record.id, shortcuts.length, usedIds),
      combo,
      href,
      label,
      newTab: record.newTab !== false,
    })
  }
  const seeded = shortcuts[0]
  if (
    shortcuts.length === 1 &&
    seeded?.id === "sc_realtime" &&
    seeded.newTab &&
    seeded.href === REALTIME_QUOTES_HREF &&
    (seeded.combo === "ctrl+i" || seeded.combo === "ctrl+t" || seeded.combo === "ctrl+alt+t")
  ) {
    seeded.combo = "ctrl+alt+t"
    seeded.href = PRO_TRADING_HREF
    seeded.label = "专业交易"
  }
  return shortcuts
}
