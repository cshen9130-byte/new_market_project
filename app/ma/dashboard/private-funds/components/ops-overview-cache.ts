import type { DataOverviewResponse, DataOverviewScope } from "@/lib/ops-data-overview"
import type { UpdateChannel, UpdateChannelResponse } from "@/lib/ops-update-channel"
import type { WeeklyReviewDataStatus, WeeklyReviewStatusVariant } from "@/lib/weekly-review-data-status"

const memory = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()
const generation = new Map<string, number>()

export function peekOpsCache<T>(key: string): T | null {
  return (memory.get(key) as T | undefined) ?? null
}

function messageOf(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "message" in json && typeof json.message === "string") {
    return json.message
  }
  return fallback
}

export function loadOpsCache<T>(
  key: string,
  url: string,
  refresh: boolean,
  accept: (json: unknown) => json is T,
  fallback: string,
): Promise<T> {
  if (!refresh) {
    const cached = memory.get(key)
    if (cached) return Promise.resolve(cached as T)
    const pending = inflight.get(key)
    if (pending) return pending as Promise<T>
  }

  const gen = (generation.get(key) ?? 0) + (refresh ? 1 : 0)
  if (refresh) generation.set(key, gen)
  const current = generation.get(key) ?? 0
  const promise = fetch(url, { cache: "no-store" }).then(async (res) => {
    const json: unknown = await res.json()
    if (!res.ok || !accept(json)) throw new Error(messageOf(json, fallback))
    if ((generation.get(key) ?? 0) === current) memory.set(key, json)
    return json
  }).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key)
  })
  inflight.set(key, promise)
  return promise
}

export function isOverviewBody(json: unknown): json is DataOverviewResponse {
  if (!json || typeof json !== "object") return false
  const body = json as DataOverviewResponse
  return typeof body.scope === "string" && Array.isArray(body.sections)
}

export function isChannelBody(json: unknown): json is UpdateChannelResponse {
  if (!json || typeof json !== "object") return false
  const body = json as UpdateChannelResponse
  return typeof body.channel === "string" && Array.isArray(body.coverage)
}

export function isWeeklyBody(json: unknown): json is WeeklyReviewDataStatus {
  if (!json || typeof json !== "object") return false
  const body = json as WeeklyReviewDataStatus
  return typeof body.variant === "string" && Array.isArray(body.categories)
}

export function overviewCacheKey(scope: DataOverviewScope): string {
  return `overview:v12:${scope}`
}

export function channelCacheKey(channel: UpdateChannel): string {
  return `channel:v8:${channel}`
}

export function weeklyCacheKey(variant: WeeklyReviewStatusVariant, pools: string, weekEnd: string): string {
  return `weekly:v5:${variant}:${pools}:${weekEnd}`
}

export function prefetchOpsCache(
  key: string,
  url: string,
  accept: (json: unknown) => boolean,
  fallback: string,
): void {
  void loadOpsCache(key, url, false, accept as (json: unknown) => json is unknown, fallback).catch(() => undefined)
}
