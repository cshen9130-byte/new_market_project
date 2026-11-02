import { isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"

export type WindowInput = { unix: number; hasTime: boolean }

export type InputLock = {
  fromUnix: number
  toUnix: number
  fromHasTime: boolean
  toHasTime: boolean
  /** The user typed this edge. An untyped end stays on the latest bar. */
  fromUser: boolean
  toUser: boolean
}

/**
 * Start and end are independent. A new start keeps a typed end, and otherwise
 * lands on the latest bar. A new end keeps a typed start.
 */
export function lockAfterCommit(
  edge: "start" | "end",
  parsed: WindowInput,
  prev: InputLock | null,
  shownFrom: number | null,
  lastUnix: number,
): InputLock {
  if (edge === "start") {
    const keepEnd = prev?.toUser === true
    return {
      fromUnix: parsed.unix,
      fromHasTime: parsed.hasTime,
      fromUser: true,
      toUnix: keepEnd ? prev.toUnix : lastUnix,
      toHasTime: keepEnd ? prev.toHasTime : true,
      toUser: keepEnd,
    }
  }
  return {
    fromUnix: prev?.fromUser ? prev.fromUnix : (shownFrom ?? parsed.unix),
    fromHasTime: prev?.fromUser ? prev.fromHasTime : false,
    fromUser: prev?.fromUser ?? false,
    toUnix: parsed.unix,
    toHasTime: parsed.hasTime,
    toUser: true,
  }
}

/** `2026.10.16` for a daily bar. Intraday bars also show the clock. */
export function formatWindowInput(unix: number, interval: TimeframeId) {
  const d = new Date(unix * 1000)
  const date = `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`
  if (!isIntradayTimeframe(interval)) return date
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${date} ${hh}:${mm}`
}

/** Accepts `2026.10.16`, `2026-10-16`, and an optional `HH:mm`. */
export function parseWindowInput(text: string): WindowInput | null {
  const match = text.trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hasTime = match[4] != null
  const hour = hasTime ? Number(match[4]) : 0
  const minute = hasTime ? Number(match[5]) : 0
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const unix = Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000)
  const check = new Date(unix * 1000)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null
  return { unix, hasTime }
}
