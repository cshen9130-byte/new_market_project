"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { zhCN } from "date-fns/locale"
import { CalendarDays, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EventTimedTimeline, MARKET_EVENT_DOM_ID, findNextEventIndex } from "@/components/ma/event-caliper-rail"
import { cn } from "@/lib/utils"
import {
  formatDateCn,
  formatEventPrints,
  formatWeekdayCn,
  listRelatedEvents,
  SERIES_DETAIL,
  type MarketEvent,
  type MarketEventImpact,
  type MarketEventRegion,
  REGION_LABEL,
} from "@/lib/ma/market-event-calendar-shared"

type Horizon = "upcoming" | "history"
type RangeKey = "7" | "14" | "31"
type RegionFilter = "ALL" | MarketEventRegion | "HIGH"

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7", label: "近7天" },
  { key: "14", label: "近14天" },
  { key: "31", label: "近一月" },
]

const REGION_OPTIONS: { key: RegionFilter; label: string }[] = [
  { key: "ALL", label: "全部" },
  { key: "HIGH", label: "高影响" },
  { key: "CN", label: "中国" },
  { key: "US", label: "美国" },
  { key: "EU", label: "欧日" },
]

function impactLabel(impact: MarketEventImpact): string {
  if (impact === "high") return "高"
  if (impact === "medium") return "中"
  if (impact === "low") return "低"
  return "休市"
}

function impactClass(impact: MarketEventImpact): string {
  if (impact === "high") return "border-red-200 bg-red-50 text-red-700"
  if (impact === "medium") return "border-amber-200 bg-amber-50 text-amber-800"
  if (impact === "low") return "border-slate-200 bg-slate-50 text-slate-600"
  return "border-zinc-200 bg-zinc-50 text-zinc-600"
}

function regionClass(region: MarketEventRegion): string {
  if (region === "CN") return "border-rose-200 bg-rose-50 text-rose-700"
  if (region === "US") return "border-sky-200 bg-sky-50 text-sky-700"
  if (region === "EU") return "border-indigo-200 bg-indigo-50 text-indigo-700"
  if (region === "JP") return "border-orange-200 bg-orange-50 text-orange-800"
  return "border-zinc-200 bg-zinc-50 text-zinc-600"
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function localDateToIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function matchesRegion(event: MarketEvent, filter: RegionFilter): boolean {
  if (filter === "ALL") return true
  if (filter === "HIGH") return event.impact === "high"
  if (filter === "EU") return event.region === "EU" || event.region === "JP"
  return event.region === filter
}

const MARKET_CLOCKS = [
  { label: "北京", zone: "Asia/Shanghai" },
  { label: "纽约", zone: "America/New_York" },
  { label: "伦敦", zone: "Europe/London" },
  { label: "东京", zone: "Asia/Tokyo" },
] as const

function formatZoneTime(date: Date, timeZone: string, withSeconds = false) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(date)
}

function zoneClockParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(date)
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { hour: num("hour"), minute: num("minute"), second: num("second") }
}

function AnalogClock({ date }: { date: Date }) {
  const { hour, minute, second } = zoneClockParts(date, "Asia/Shanghai")
  const secondDeg = second * 6
  const minuteDeg = minute * 6 + second * 0.1
  const hourDeg = (hour % 12) * 30 + minute * 0.5

  return (
    <div className="relative mx-auto size-[8.5rem]">
      <svg viewBox="0 0 100 100" className="size-full text-foreground">
        <circle cx="50" cy="50" r="48" fill="none" className="stroke-border" strokeWidth="1.5" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i * 30 - 90) * Math.PI) / 180
          const outer = 44
          const inner = i % 3 === 0 ? 37 : 40
          return (
            <line
              key={i}
              x1={50 + Math.cos(a) * inner}
              y1={50 + Math.sin(a) * inner}
              x2={50 + Math.cos(a) * outer}
              y2={50 + Math.sin(a) * outer}
              className={i % 3 === 0 ? "stroke-foreground" : "stroke-muted-foreground/50"}
              strokeWidth={i % 3 === 0 ? 1.6 : 1}
              strokeLinecap="round"
            />
          )
        })}
        <line
          x1="50"
          y1="50"
          x2={50 + Math.cos(((hourDeg - 90) * Math.PI) / 180) * 22}
          y2={50 + Math.sin(((hourDeg - 90) * Math.PI) / 180) * 22}
          className="stroke-foreground"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <line
          x1="50"
          y1="50"
          x2={50 + Math.cos(((minuteDeg - 90) * Math.PI) / 180) * 32}
          y2={50 + Math.sin(((minuteDeg - 90) * Math.PI) / 180) * 32}
          className="stroke-foreground"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <line
          x1="50"
          y1="54"
          x2={50 + Math.cos(((secondDeg - 90) * Math.PI) / 180) * 36}
          y2={50 + Math.sin(((secondDeg - 90) * Math.PI) / 180) * 36}
          className="stroke-red-500"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle cx="50" cy="50" r="2.2" className="fill-foreground" />
      </svg>
    </div>
  )
}

function MarketWorldClock() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    const tick = () => setNow(new Date())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  const beijingDate = now
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "numeric",
        day: "numeric",
        weekday: "short",
      }).format(now)
    : ""

  return (
    <div className="mt-3 border-t pt-3">
      <p className="mb-2 px-1 text-sm font-medium">北京时间</p>
      {now ? (
        <>
          <AnalogClock date={now} />
          <p className="mt-2 text-center text-lg font-semibold tabular-nums tracking-wide">
            {formatZoneTime(now, "Asia/Shanghai", true)}
          </p>
          <p className="text-center text-[11px] text-muted-foreground">{beijingDate}</p>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {MARKET_CLOCKS.filter((item) => item.zone !== "Asia/Shanghai").map((item) => (
              <div key={item.zone} className="rounded-md border px-1.5 py-1.5 text-center">
                <div className="text-[10px] text-muted-foreground">{item.label}</div>
                <div className="text-xs font-medium tabular-nums">{formatZoneTime(now, item.zone)}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mx-auto h-[8.5rem] w-[8.5rem] rounded-full border border-dashed" />
      )}
    </div>
  )
}

function EventBadges({ item, hideTime }: { item: MarketEvent; hideTime?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className={cn("text-[11px]", impactClass(item.impact))}>
        {impactLabel(item.impact)}
      </Badge>
      <Badge variant="outline" className={cn("text-[11px]", regionClass(item.region))}>
        {REGION_LABEL[item.region]}
      </Badge>
      {!hideTime && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {item.time || "全天"}
          {item.timeNote ? ` · ${item.timeNote}` : ""}
        </span>
      )}
      {item.tentative && <span className="text-[11px] text-muted-foreground">待官方确认</span>}
    </div>
  )
}

export function MarketEventCalendar({
  today,
  events,
  sourceLabel,
}: {
  today: string
  events: MarketEvent[]
  sourceLabel?: string
}) {
  const [horizon, setHorizon] = useState<Horizon>("upcoming")
  const [range, setRange] = useState<RangeKey>("14")
  const [region, setRegion] = useState<RegionFilter>("ALL")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const [month, setMonth] = useState(() => isoToLocalDate(today))
  const [activeCaliperId, setActiveCaliperId] = useState<string | null>(null)
  const [followLive, setFollowLive] = useState(true)

  const weekDays = useMemo(
    () =>
      horizon === "upcoming"
        ? Array.from({ length: 7 }, (_, i) => addDays(today, i))
        : Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)),
    [today, horizon],
  )

  const regionEvents = useMemo(
    () => events.filter((item) => matchesRegion(item, region)),
    [events, region],
  )

  const filtered = useMemo(() => {
    if (pickedDate) {
      return regionEvents
        .filter((item) => item.date === pickedDate)
        .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"))
    }
    const span = Number(range) - 1
    const start = horizon === "upcoming" ? today : addDays(today, -span)
    const end = horizon === "upcoming" ? addDays(today, span) : addDays(today, -1)
    return regionEvents
      .filter((item) => item.date >= start && item.date <= end)
      .sort((a, b) => {
        const dir = horizon === "history" ? -1 : 1
        if (a.date !== b.date) return a.date.localeCompare(b.date) * dir
        return (a.time || "99:99").localeCompare(b.time || "99:99") * dir
      })
  }, [regionEvents, today, range, horizon, pickedDate])

  const markManualNavigate = useCallback(() => {
    setFollowLive(false)
  }, [])

  const resumeFollow = useCallback(() => {
    setPickedDate(null)
    setHorizon("upcoming")
    setFollowLive(true)
  }, [])

  useEffect(() => {
    if (followLive) {
      const next = findNextEventIndex(filtered)
      setActiveCaliperId(next >= 0 ? filtered[next].id : (filtered[0]?.id ?? null))
      return
    }
    if (!filtered.some((item) => item.id === activeCaliperId)) {
      setActiveCaliperId(filtered[0]?.id ?? null)
    }
  }, [filtered, followLive, activeCaliperId])

  const eventDates = useMemo(() => new Set(filtered.map((item) => item.date)), [filtered])
  const calendarEventDates = useMemo(
    () => regionEvents.map((item) => isoToLocalDate(item.date)),
    [regionEvents],
  )
  const highCount = filtered.filter((item) => item.impact === "high").length
  const mediumCount = filtered.filter((item) => item.impact === "medium").length
  const lowCount = filtered.filter((item) => item.impact === "low").length

  function pickDate(iso: string) {
    setPickedDate(iso)
    setMonth(isoToLocalDate(iso))
    if (iso < today) setHorizon("history")
    else setHorizon("upcoming")
    markManualNavigate()
  }

  function clearPickedDate() {
    setPickedDate(null)
  }
  const selected = events.find((item) => item.id === selectedId) ?? null
  const related = selected ? listRelatedEvents(selected, events) : []
  const selectedMeta = selected ? SERIES_DETAIL[selected.series] : null
  const selectedPast = selected ? selected.date < today : false

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              setHorizon("upcoming")
              clearPickedDate()
              setFollowLive(true)
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              horizon === "upcoming" && !pickedDate
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            即将
          </button>
          <button
            type="button"
            onClick={() => {
              setHorizon("history")
              clearPickedDate()
              markManualNavigate()
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              horizon === "history" && !pickedDate
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            历史
          </button>
          <span className="mx-1 hidden h-5 w-px bg-border sm:inline-block" />
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setRange(opt.key)
                clearPickedDate()
              }}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                range === opt.key && !pickedDate
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REGION_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRegion(opt.key)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                region === opt.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start">
        <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-7 gap-1.5">
        {weekDays.map((date) => {
          const hasEvent = eventDates.has(date) || regionEvents.some((item) => item.date === date)
          const isToday = date === today
          const isPicked = date === pickedDate
          return (
            <button
              key={date}
              type="button"
              onClick={() => pickDate(date)}
              className={cn(
                "rounded-lg border px-1.5 py-2 text-center transition-colors hover:bg-muted/50",
                isPicked
                  ? "border-sky-300 bg-sky-100 text-sky-950"
                  : isToday
                    ? "border-foreground/30 bg-muted/60"
                    : "border-border",
                hasEvent && !isToday && !isPicked && "bg-muted/30",
              )}
            >
              <div className={cn("text-[10px]", isPicked ? "text-sky-700/80" : "text-muted-foreground")}>
                {formatWeekdayCn(date)}
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {Number(date.slice(8))}
              </div>
              <div className="mt-1 flex justify-center">
                <span className={cn("h-1.5 w-1.5 rounded-full", hasEvent ? "bg-red-500" : "bg-transparent")} />
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {pickedDate ? (
          <>
            {formatDateCn(pickedDate)} {formatWeekdayCn(pickedDate)} {filtered.length} 项
            {pickedDate === today ? " · 今天" : pickedDate < today ? " · 已发生" : " · 即将"}
          </>
        ) : (
          <>
            {horizon === "upcoming" ? "未来" : "过去"} {range === "7" ? "7" : range === "14" ? "14" : "31"} 天{" "}
            {filtered.length} 项
          </>
        )}
        {highCount + mediumCount + lowCount > 0
          ? ` · 高 ${highCount} · 中 ${mediumCount} · 低 ${lowCount}`
          : ""}
        · 点击卡片查看详情 · 左侧每小时等长，事件按北京时间落点 · 拖动或滚动后暂停跟随
        {sourceLabel ? ` · ${sourceLabel}` : ""}
        {pickedDate && (
          <button type="button" onClick={clearPickedDate} className="ml-2 underline underline-offset-2 hover:text-foreground">
            返回列表
          </button>
        )}
      </p>

      {filtered.length === 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-6">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">
              {pickedDate ? `${formatDateCn(pickedDate)}暂无事件` : horizon === "history" ? "所选范围内暂无历史事件" : "所选范围内暂无事件"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pickedDate ? "可在右侧日历选择其他日期，或返回列表。" : "可切换时间范围或地区筛选。"}
            </p>
          </div>
        </div>
      ) : (
        <EventTimedTimeline
          events={filtered}
          today={today}
          activeId={activeCaliperId}
          followLive={followLive}
          onActiveIdChange={setActiveCaliperId}
          onManualNavigate={markManualNavigate}
          onResumeFollow={resumeFollow}
        >
          {(item, ctx) => (
            <button
              id={MARKET_EVENT_DOM_ID(item.id)}
              data-event-id={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id)
                setActiveCaliperId(item.id)
                markManualNavigate()
              }}
              className={cn(
                "w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ctx.active && "border-foreground/40 bg-muted/40",
                ctx.next && !ctx.active && "border-sky-200",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <EventBadges item={item} hideTime />
                  <h4 className="mt-1.5 font-semibold leading-snug">{item.title}</h4>
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{item.summary}</p>
                  {formatEventPrints(item) && (
                    <p className="mt-1 line-clamp-1 text-xs text-foreground/80">{formatEventPrints(item)}</p>
                  )}
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </button>
          )}
        </EventTimedTimeline>
      )}
        </div>

        <aside className="rounded-lg border p-3 lg:sticky lg:top-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-sm font-medium">选择日期</p>
            <p className="text-[11px] text-muted-foreground">红点表示有事件</p>
          </div>
          <Calendar
            mode="single"
            locale={zhCN}
            month={month}
            onMonthChange={setMonth}
            selected={pickedDate ? isoToLocalDate(pickedDate) : undefined}
            onSelect={(date) => {
              if (!date) {
                clearPickedDate()
                return
              }
              pickDate(localDateToIso(date))
            }}
            modifiers={{ hasEvent: calendarEventDates }}
            modifiersClassNames={{
              hasEvent:
                "relative after:absolute after:bottom-0.5 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-red-500",
            }}
            className="w-full p-0"
            classNames={{
              root: "w-full",
              day_button:
                "data-[selected-single=true]:bg-sky-100 data-[selected-single=true]:text-sky-950 data-[selected-single=true]:hover:bg-sky-100",
            }}
          />
          <MarketWorldClock />
        </aside>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="flex max-h-[min(88vh,40rem)] max-w-xl flex-col gap-4 overflow-hidden sm:max-w-xl">
          {selected && selectedMeta && (
            <>
              <DialogHeader className="pr-8">
                <DialogTitle className="leading-snug">{selected.title}</DialogTitle>
                <DialogDescription className="sr-only">{selected.summary}</DialogDescription>
                <div className="pt-1">
                  <EventBadges item={selected} />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatDateCn(selected.date)} {formatWeekdayCn(selected.date)}
                    {selectedPast ? " · 已发生" : selected.date === today ? " · 今天" : " · 即将公布"}
                    {` · ${selectedMeta.label}`}
                  </p>
                </div>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
                {(selected.actual || selected.forecast || selected.previous || selected.outcome) && (
                  <section className="rounded-lg border bg-muted/40 p-3">
                    <h5 className="text-xs font-medium text-muted-foreground">公布结果</h5>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-[11px] text-muted-foreground">今值</div>
                        <div className="font-medium">{selected.actual || "待公布"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">预期</div>
                        <div className="font-medium">{selected.forecast || "—"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">前值</div>
                        <div className="font-medium">{selected.previous || "—"}</div>
                      </div>
                    </div>
                    {selected.outcome && !selected.actual && (
                      <p className="mt-2 leading-relaxed">{selected.outcome}</p>
                    )}
                  </section>
                )}
                <section>
                  <h5 className="text-xs font-medium text-muted-foreground">为什么重要</h5>
                  <p className="mt-1 leading-relaxed text-foreground/90">{selectedMeta.whyItMatters}</p>
                  <p className="mt-2 leading-relaxed text-muted-foreground">{selected.summary}</p>
                </section>
                <section>
                  <h5 className="text-xs font-medium text-muted-foreground">关注要点</h5>
                  <ul className="mt-1 list-disc space-y-1 pl-4 leading-relaxed">
                    {selectedMeta.watchPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h5 className="text-xs font-medium text-muted-foreground">可能影响的市场</h5>
                  <p className="mt-1">{selected.markets.join(" · ")}</p>
                </section>
                {selectedMeta.sourceUrl ? (
                  <p className="text-xs text-muted-foreground">
                    来源：{" "}
                    <a
                      href={selectedMeta.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {selectedMeta.source}
                    </a>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">来源：{selectedMeta.source}</p>
                )}
                {related.length > 0 && (
                  <section>
                    <h5 className="text-xs font-medium text-muted-foreground">同类事件</h5>
                    <div className="mt-2 space-y-1.5">
                      {related.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50"
                        >
                          <span className="min-w-0 truncate">
                            {formatDateCn(item.date)} {item.title}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {item.date < today ? "已发生" : "即将"}
                            {item.outcome ? " · 有结果" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
