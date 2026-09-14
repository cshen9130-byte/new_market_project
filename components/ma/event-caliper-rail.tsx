"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { MarketEvent } from "@/lib/ma/market-event-calendar-shared"

export const MARKET_EVENT_DOM_ID = (id: string) => `market-event-${id}`

const HOUR_MS = 3_600_000
const EMPTY_HOUR_PX = 32

function shortDate(iso: string) {
  const [, m, d] = iso.split("-")
  return `${Number(m)}/${Number(d)}`
}

function eventClock(event: MarketEvent) {
  return event.time || "全天"
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Shanghai wall time as UTC ms. China has no DST. */
export function eventStartMs(event: MarketEvent): number {
  const [y, mo, d] = event.date.split("-").map(Number)
  const clock = event.time && /^\d{1,2}:\d{2}$/.test(event.time) ? event.time : "00:00"
  const [hh, mm] = clock.split(":").map(Number)
  return Date.UTC(y, mo - 1, d, hh - 8, mm, 0)
}

export function findNextEventIndex(events: MarketEvent[], now = Date.now()): number {
  if (events.length === 0) return -1
  const idx = events.findIndex((item) => eventStartMs(item) >= now)
  return idx === -1 ? -1 : idx
}

function floorHour(ms: number) {
  return Math.floor(ms / HOUR_MS) * HOUR_MS
}

function ceilHour(ms: number) {
  return Math.ceil(ms / HOUR_MS) * HOUR_MS
}

function shanghaiHourParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms))
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    hour: num("hour"),
    label: `${pad(num("hour"))}:${pad(num("minute"))}`,
    dateLabel: `${num("month")}/${num("day")}`,
  }
}

type HourSlot = {
  hourMs: number
  events: { event: MarketEvent; index: number }[]
}

type TimelineRow =
  | { type: "empty"; start: number; count: number }
  | { type: "slot"; hourMs: number; events: HourSlot["events"] }

function buildRows(events: MarketEvent[], nowMs: number): { t0: number; t1: number; rows: TimelineRow[] } {
  const starts = events.map(eventStartMs)
  let t0 = floorHour(Math.min(...starts))
  let t1 = ceilHour(Math.max(...starts) + HOUR_MS)
  if (nowMs >= t0 - HOUR_MS && nowMs <= t1 + 6 * HOUR_MS) {
    t0 = Math.min(t0, floorHour(nowMs))
    t1 = Math.max(t1, ceilHour(nowMs + HOUR_MS))
  }
  if (t1 <= t0) t1 = t0 + HOUR_MS

  const buckets = new Map<number, HourSlot>()
  for (let t = t0; t < t1; t += HOUR_MS) {
    buckets.set(t, { hourMs: t, events: [] })
  }
  events.forEach((event, index) => {
    const hourMs = floorHour(eventStartMs(event))
    const bucket = buckets.get(hourMs) ?? { hourMs, events: [] }
    bucket.events.push({ event, index })
    buckets.set(hourMs, bucket)
  })

  const rows: TimelineRow[] = []
  let emptyStart: number | null = null
  let emptyCount = 0
  const flushEmpty = () => {
    if (emptyStart != null && emptyCount > 0) {
      rows.push({ type: "empty", start: emptyStart, count: emptyCount })
    }
    emptyStart = null
    emptyCount = 0
  }

  for (const bucket of [...buckets.values()].sort((a, b) => a.hourMs - b.hourMs)) {
    if (bucket.events.length === 0) {
      if (emptyStart == null) emptyStart = bucket.hourMs
      emptyCount += 1
      continue
    }
    flushEmpty()
    rows.push({ type: "slot", hourMs: bucket.hourMs, events: bucket.events })
  }
  flushEmpty()

  return { t0, t1, rows }
}

function groupByClock(events: { event: MarketEvent; index: number }[]) {
  const groups: { clock: string; items: { event: MarketEvent; index: number }[] }[] = []
  for (const item of events) {
    const clock = item.event.time || "全天"
    const last = groups[groups.length - 1]
    if (last && last.clock === clock) last.items.push(item)
    else groups.push({ clock, items: [item] })
  }
  return groups
}

function ScaleTick({
  ms,
  today,
  major,
}: {
  ms: number
  today: string
  major: boolean
}) {
  const part = shanghaiHourParts(ms)
  const isMidnight = part.hour === 0
  const todayLabel = `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}`
  return (
    <div className="flex items-center justify-end gap-1">
      {isMidnight && (
        <span
          className={cn(
            "text-[10px] font-semibold tabular-nums",
            part.dateLabel === todayLabel ? "text-foreground" : "text-foreground/80",
          )}
        >
          {part.dateLabel}
        </span>
      )}
      {(major || isMidnight) && !isMidnight && (
        <span className="text-[10px] tabular-nums text-muted-foreground">{part.label}</span>
      )}
      <span
        className={cn(
          "block h-px",
          isMidnight ? "w-3.5 bg-foreground/70" : major ? "w-2.5 bg-foreground/40" : "w-1.5 bg-foreground/20",
        )}
      />
    </div>
  )
}

export function EventTimedTimeline({
  events,
  today,
  activeId,
  followLive,
  onActiveIdChange,
  onManualNavigate,
  onResumeFollow,
  children,
}: {
  events: MarketEvent[]
  today: string
  activeId: string | null
  followLive: boolean
  onActiveIdChange: (id: string) => void
  onManualNavigate: () => void
  onResumeFollow: () => void
  children: (item: MarketEvent, ctx: { active: boolean; next: boolean }) => ReactNode
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const dragModeRef = useRef<"coarse" | "fine">("coarse")
  const dragStartYRef = useRef(0)
  const dragStartIndexRef = useRef(0)
  const programmaticScrollRef = useRef(false)
  const followedIdRef = useRef<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const activeIndex = Math.max(
    0,
    events.findIndex((item) => item.id === activeId),
  )
  const nextIndex = findNextEventIndex(events, nowMs)
  const { rows } = useMemo(() => buildRows(events, nowMs), [events, nowMs])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const scrollToEvent = useCallback((id: string, smooth: boolean) => {
    programmaticScrollRef.current = true
    document.getElementById(MARKET_EVENT_DOM_ID(id))?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "center",
    })
    window.setTimeout(() => {
      programmaticScrollRef.current = false
    }, 1000)
  }, [])

  const goToIndex = useCallback(
    (index: number, smooth: boolean, manual: boolean) => {
      const next = clamp(index, 0, events.length - 1)
      const id = events[next]?.id
      if (!id) return
      if (manual) onManualNavigate()
      onActiveIdChange(id)
      scrollToEvent(id, smooth)
    },
    [events, onActiveIdChange, onManualNavigate, scrollToEvent],
  )

  const yToIndex = useCallback(
    (clientY: number) => {
      if (events.length === 0) return 0
      let best = 0
      let bestDist = Infinity
      events.forEach((event, index) => {
        const el = document.getElementById(MARKET_EVENT_DOM_ID(event.id))
        const rect = el?.getBoundingClientRect()
        const mid = rect ? (rect.top + rect.bottom) / 2 : Number.POSITIVE_INFINITY
        const dist = Math.abs(mid - clientY)
        if (dist < bestDist) {
          bestDist = dist
          best = index
        }
      })
      return best
    },
    [events],
  )

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!draggingRef.current) return
      e.preventDefault()
      if (dragModeRef.current === "coarse") {
        goToIndex(yToIndex(e.clientY), false, true)
        return
      }
      const steps = Math.round((e.clientY - dragStartYRef.current) / 10)
      goToIndex(dragStartIndexRef.current + steps, false, true)
    }
    function onUp() {
      draggingRef.current = false
    }
    window.addEventListener("pointermove", onMove, { passive: false })
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [goToIndex, yToIndex])

  useEffect(() => {
    if (!followLive) return
    const next = findNextEventIndex(events, nowMs)
    if (next < 0) return
    const id = events[next]?.id
    if (!id) return
    if (followedIdRef.current === id && activeId === id) return
    followedIdRef.current = id
    onActiveIdChange(id)
    scrollToEvent(id, true)
  }, [followLive, events, nowMs, activeId, onActiveIdChange, scrollToEvent])

  useEffect(() => {
    if (followLive) return
    if (!events.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (draggingRef.current || programmaticScrollRef.current) return
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const id = visible[0]?.target.getAttribute("data-event-id")
        if (id) onActiveIdChange(id)
      },
      { rootMargin: "-32% 0px -48% 0px", threshold: 0.05 },
    )
    for (const event of events) {
      const node = document.getElementById(MARKET_EVENT_DOM_ID(event.id))
      if (node) observer.observe(node)
    }
    return () => observer.disconnect()
  }, [events, followLive, onActiveIdChange])

  useEffect(() => {
    const pauseIfBrowse = (event: Event) => {
      if (!followLive || draggingRef.current) return
      const target = event.target
      if (target instanceof Element && target.closest("[data-scale]")) return
      onManualNavigate()
    }
    const onKey = (event: KeyboardEvent) => {
      if (!["PageDown", "PageUp", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
      if (document.activeElement instanceof Element && document.activeElement.closest("[data-scale]")) return
      pauseIfBrowse(event)
    }
    window.addEventListener("wheel", pauseIfBrowse, { passive: true })
    window.addEventListener("touchmove", pauseIfBrowse, { passive: true })
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("wheel", pauseIfBrowse)
      window.removeEventListener("touchmove", pauseIfBrowse)
      window.removeEventListener("keydown", onKey)
    }
  }, [followLive, onManualNavigate])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!events.length) return
      const target = e.target
      if (!(target instanceof Element) || !target.closest("[data-scale]")) return
      if (Math.abs(e.deltaY) < 4 && Math.abs(e.deltaX) < 4) return
      e.preventDefault()
      goToIndex(activeIndex + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1), false, true)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [activeIndex, events.length, goToIndex])

  if (events.length === 0) return null

  const active = events[activeIndex]
  const nextEvent = nextIndex >= 0 ? events[nextIndex] : null
  const nowHour = floorHour(nowMs)

  function beginDrag(e: React.PointerEvent, mode: "coarse" | "fine") {
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = true
    dragModeRef.current = mode
    dragStartYRef.current = e.clientY
    dragStartIndexRef.current = activeIndex
    trackRef.current?.setPointerCapture(e.pointerId)
    onManualNavigate()
    if (mode === "coarse") goToIndex(yToIndex(e.clientY), false, true)
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (followLive) return
          onResumeFollow()
        }}
        className={cn(
          "mb-3 rounded-md border px-2.5 py-1.5 text-left text-xs leading-tight",
          followLive
            ? "border-foreground/20 bg-muted/40 text-foreground"
            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {followLive ? (
          <span>
            跟随下一项
            {nextEvent ? ` · ${shortDate(nextEvent.date)} ${eventClock(nextEvent)}` : " · 已无后续"}
          </span>
        ) : (
          <span>已暂停跟随 · 点击恢复</span>
        )}
      </button>

      <div
        ref={trackRef}
        role="slider"
        aria-label="事件时间尺"
        aria-valuemin={1}
        aria-valuemax={events.length}
        aria-valuenow={activeIndex + 1}
        aria-valuetext={active ? `${shortDate(active.date)} ${eventClock(active)} ${active.title}` : ""}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "PageDown") {
            e.preventDefault()
            goToIndex(activeIndex + (e.key === "PageDown" ? 5 : 1), false, true)
          } else if (e.key === "ArrowUp" || e.key === "PageUp") {
            e.preventDefault()
            goToIndex(activeIndex - (e.key === "PageUp" ? 5 : 1), false, true)
          } else if (e.key === "Home") {
            e.preventDefault()
            goToIndex(0, true, true)
          } else if (e.key === "End") {
            e.preventDefault()
            goToIndex(events.length - 1, true, true)
          }
        }}
        className="outline-none"
      >
        <div className="flex flex-col">
          {rows.map((row) => {
            if (row.type === "empty") {
              const hasNow = nowMs >= row.start && nowMs < row.start + row.count * HOUR_MS
              const nowOffset = hasNow ? ((nowMs - row.start) / HOUR_MS) * EMPTY_HOUR_PX : null
              return (
                <div key={`empty-${row.start}`} className="relative flex" style={{ height: row.count * EMPTY_HOUR_PX }}>
                  <div
                    data-scale
                    className="flex w-[4.75rem] shrink-0 touch-none select-none flex-col justify-between border-r border-foreground/20 py-0.5 pr-2"
                    onPointerDown={(e) => beginDrag(e, "coarse")}
                  >
                    {Array.from({ length: row.count }, (_, i) => {
                      const ms = row.start + i * HOUR_MS
                      const part = shanghaiHourParts(ms)
                      const major = part.hour === 0 || part.hour % 3 === 0
                      return <ScaleTick key={ms} ms={ms} today={today} major={major} />
                    })}
                  </div>
                  <div className="relative min-w-0 flex-1">
                    {nowOffset != null && (
                      <div className="pointer-events-none absolute inset-x-0" style={{ top: nowOffset }}>
                        <div className="h-px bg-red-500/70" />
                        <span className="absolute left-2 -top-2 text-[9px] font-medium text-red-600">现在</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            }

            const part = shanghaiHourParts(row.hourMs)
            const isNowHour = nowHour === row.hourMs
            const clockGroups = groupByClock(row.events)
            const showHourTick = part.hour === 0
            return (
              <div key={`slot-${row.hourMs}`} className="relative flex">
                <div
                  data-scale
                  className="flex w-[4.75rem] shrink-0 touch-none select-none flex-col items-end gap-1.5 border-r border-foreground/20 py-2 pr-2"
                  onPointerDown={(e) => beginDrag(e, "coarse")}
                >
                  {showHourTick && <ScaleTick ms={row.hourMs} today={today} major />}
                  {clockGroups.map((group) => {
                    const first = group.items[0]
                    const isActive = group.items.some((item) => item.event.id === activeId)
                    const isNext = group.items.some((item) => item.index === nextIndex)
                    const isHigh = group.items.some((item) => item.event.impact === "high")
                    const isMedium = !isHigh && group.items.some((item) => item.event.impact === "medium")
                    return (
                      <button
                        key={`${row.hourMs}-${group.clock}`}
                        type="button"
                        title={`${shortDate(first.event.date)} ${group.clock}${group.items.length > 1 ? ` · ${group.items.length} 项` : ""}`}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          goToIndex(first.index, true, true)
                        }}
                        className={cn(
                          "flex items-center gap-1 text-[10px] tabular-nums leading-none",
                          isActive || isNext ? "font-semibold text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <span>
                          {group.clock}
                          {group.items.length > 1 ? ` ·${group.items.length}` : ""}
                        </span>
                        <span
                          className={cn(
                            "block h-px w-3",
                            isHigh ? "bg-red-500" : isMedium ? "bg-amber-500" : isActive ? "bg-foreground" : "bg-foreground/50",
                          )}
                        />
                      </button>
                    )
                  })}
                </div>
                <div className="min-w-0 flex-1 space-y-2 py-2 pl-3">
                  {isNowHour && (
                    <div className="relative mb-1">
                      <div className="h-px bg-red-500/70" />
                      <span className="absolute left-0 -top-2 text-[9px] font-medium text-red-600">现在</span>
                    </div>
                  )}
                  {row.events.map(({ event, index }) => (
                    <div key={event.id} className="relative">
                      {event.id === activeId && (
                        <button
                          type="button"
                          aria-label="拖动游标"
                          onPointerDown={(e) => beginDrag(e, "fine")}
                          className="absolute -left-[1.15rem] top-3 z-20 size-3 rounded-full border border-foreground bg-background shadow-sm"
                        />
                      )}
                      {children(event, {
                        active: event.id === activeId,
                        next: index === nextIndex,
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** @deprecated use EventTimedTimeline */
export const EventCaliperRail = EventTimedTimeline
