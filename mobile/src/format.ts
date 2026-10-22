export function parseNum(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function webDevServerUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:3000"
  const host = window.location.hostname || "127.0.0.1"
  return `http://${host}:3000`
}

const PRODUCTION_SERVER = "http://8.154.33.143"

export function resolveServerUrl(platform: string, dev: boolean): string {
  if (platform === "web" || dev) return webDevServerUrl()
  return PRODUCTION_SERVER
}

export function displayFundName(productName: string, shortName?: string | null): string {
  const raw = (shortName || productName || "")
    .replace(/私募证券投资基金/g, "")
    .replace(/私募股权投资基金/g, "")
    .trim()
  return raw || productName || "未命名产品"
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—"
  return value.slice(0, 10)
}

export function fmtNav(value: string | number | null | undefined, digits = 4): string {
  const n = parseNum(value)
  if (n == null) return "—"
  return n.toFixed(digits)
}

export function fmtRatioPct(value: string | number | null | undefined): { text: string; n: number | null } {
  const ratio = parseNum(value)
  if (ratio == null) return { text: "—", n: null }
  const n = ratio * 100
  return { text: signedPct(n), n }
}

export function fmtPercentPoints(value: string | number | null | undefined): { text: string; n: number | null } {
  const n = parseNum(value)
  if (n == null) return { text: "—", n: null }
  return { text: signedPct(n), n }
}

export function fmtSignedNumber(value: string | number | null | undefined, digits = 2): string {
  const n = parseNum(value)
  if (n == null) return "—"
  return n.toFixed(digits)
}

function signedPct(n: number): string {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(2)}%`
}

export function strategyLine(parts: Array<string | null | undefined>): string {
  return parts.map((part) => (part || "").trim()).filter(Boolean).join(" · ")
}
