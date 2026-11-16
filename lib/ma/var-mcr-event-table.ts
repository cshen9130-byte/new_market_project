/** Episode-window tables for the latest day's largest product and sector, matching the MOM VaR report. */

import { PROD_NAMES, prodLabel } from "@/lib/ma/prod-sector"
import {
  BOOK_CAP_MIN,
  PERSIST_DAYS,
  PRODUCT_HARD,
  PRODUCT_SOFT,
  SECTOR_HARD,
  SECTOR_SOFT,
  VAR_BUDGET_SOFT,
  sectorLabel,
  type DriverKind,
} from "@/lib/ma/var-mcr-policy"

export const MATURE_MIN_PRODUCTS = 20
export const EVENT_GAP_DAYS = 5
export const EVENT_LEADIN_DAYS = 2
export const EVENT_MIN_DAYS = 8
export const EVENT_MAX_DAYS = 18

export const SIGN_LABELS: Record<string, string> = {
  prod_soft: "品种软预警",
  prod_hard: "品种硬线",
  sec_soft: "板块软预警",
  sec_hard: "板块硬线",
  persist_hard: "硬线连续≥3日",
  persist_soft: "软线连续≥3日",
  pos_up: "持仓推动VaR上升",
  var_budget: "VaR/资本>2.07%",
  vol_spike: "波动抬升",
  corr_surge: "相关抬升",
  corr_collapse: "相关塌缩",
  regime_breadth: "同向广度极端",
  gap: "隔夜缺口",
  jump: "跳价",
  idiosyncratic: "特异波动",
  liq: "流动性收缩",
  roll: "移仓",
}

export const CONCENTRATION_SIGN_KEYS = [
  "prod_soft", "prod_hard", "sec_soft", "sec_hard",
  "persist_hard", "persist_soft", "pos_up", "var_budget",
] as const

export const REGIME_SIGN_KEYS = [
  "vol_spike", "corr_surge", "corr_collapse", "regime_breadth",
  "gap", "jump", "idiosyncratic", "liq", "roll",
] as const

export const ALL_SIGN_KEYS = [...CONCENTRATION_SIGN_KEYS, ...REGIME_SIGN_KEYS] as const

export type BookAction = "无" | "观察" | "预警" | "硬性减仓" | "硬阈值冻结"

export type DailyEventInput = {
  date: string
  maxProd: string
  maxProdShare: number
  maxSec: string
  maxSecShare: number
  driver: DriverKind
  dVar: number | null
  attrPos: number | null
  attrMkt: number | null
  varPct: number | null
  capOk: boolean
  nProd: number
  flags: Partial<Record<typeof ALL_SIGN_KEYS[number], boolean>>
}

export type BookDayState = DailyEventInput & {
  prodSoft: boolean
  prodHard: boolean
  secSoft: boolean
  secHard: boolean
  posUp: boolean
  varBudget: boolean
  streakProdSoft: number
  streakProdHard: number
  streakSecSoft: number
  streakSecHard: number
  persistHard: boolean
  persistSoft: boolean
  freeze: boolean
  signs: string[]
  signsCn: string[]
  nSigns: number
  action: BookAction
  actionDisplay: string
  driverLabel: string
}

export function classifyBookAction(input: {
  prodSoft: boolean
  prodHard: boolean
  secSoft: boolean
  secHard: boolean
  persistHard: boolean
  persistSoft: boolean
  streakProdSoft: number
  streakSecSoft: number
  posUp: boolean
  varBudget: boolean
  freeze: boolean
  nSigns: number
}): BookAction {
  const cond = input.posUp || input.varBudget
  if (input.persistHard && cond && !input.freeze) return "硬性减仓"
  if (input.persistHard && cond && input.freeze) return "硬阈值冻结"
  const soft = input.prodSoft || input.secSoft
  if (soft && (
    input.streakProdSoft >= 2
    || input.streakSecSoft >= 2
    || input.prodHard
    || input.secHard
    || input.varBudget
    || input.persistSoft
  )) {
    return "预警"
  }
  if (input.nSigns > 0) return "观察"
  return "无"
}

export function annotateAction(action: BookAction, input: {
  prodHard: boolean
  secHard: boolean
  freeze: boolean
  persistHard?: boolean
  streakProdHard?: number
  streakSecHard?: number
  jump?: boolean
}): string {
  // Match the 10-15 footnote: hard line + market, one session short of persist,
  // so a formal cut that day would have been frozen rather than executed.
  if (action !== "预警") return action
  if (!(input.prodHard || input.secHard) || !input.freeze || input.persistHard) return action
  const nearPersist = (input.streakProdHard ?? 0) >= 2 || (input.streakSecHard ?? 0) >= 2
  if (!nearPersist && !input.jump) return action
  return "预警（若硬砍则应冻结）"
}

export function driverLabel(input: {
  driver: DriverKind
  dVar: number | null
  sharePct: number
  prevSharePct: number | null
  jump?: boolean
}): string {
  if (input.driver === "market") {
    return input.jump ? "市场（跳价）" : "市场"
  }
  if (input.driver === "flat" || input.driver === "na") {
    if (input.dVar == null || Math.abs(input.dVar) < 1) return "—"
  }
  if (input.driver === "position" || (input.dVar != null && input.dVar !== 0)) {
    const dVar = input.dVar ?? 0
    if (dVar < 0) {
      const prev = input.prevSharePct
      const fellFromHard = prev != null && prev >= PRODUCT_HARD && input.sharePct < PRODUCT_SOFT
      if (fellFromHard || dVar <= -700_000) return "持仓（大幅回落）"
      if (dVar <= -200_000 || (prev != null && prev >= PRODUCT_HARD && input.sharePct < prev - 5)) {
        return "持仓（回落）"
      }
      return "持仓（VaR下降）"
    }
    return "持仓"
  }
  return "—"
}

/** Driver label for a sector episode uses the sector's soft/hard lines when judging 回落. */
export function driverLabelFor(kind: "product" | "sector", input: {
  driver: DriverKind
  dVar: number | null
  sharePct: number
  prevSharePct: number | null
  jump?: boolean
}): string {
  if (input.driver === "market") return input.jump ? "市场（跳价）" : "市场"
  if (input.driver !== "position" && (input.dVar == null || Math.abs(input.dVar) < 1)) return "—"
  const dVar = input.dVar ?? 0
  if (dVar >= 0) return "持仓"
  const hard = kind === "product" ? PRODUCT_HARD : SECTOR_HARD
  const soft = kind === "product" ? PRODUCT_SOFT : SECTOR_SOFT
  const prev = input.prevSharePct
  const fellFromHardToBelowSoft = prev != null && prev >= hard && input.sharePct < soft
  // Large drop: 07-03 style wipeout. 10-19/10-28 stay as rollback.
  if (dVar <= -700_000 || (fellFromHardToBelowSoft && input.sharePct < 10)) return "持仓（大幅回落）"
  if (dVar <= -200_000 || fellFromHardToBelowSoft || (prev != null && prev >= hard && input.sharePct < prev - 5)) return "持仓（回落）"
  return "持仓（VaR下降）"
}

export function attachBookState(days: readonly DailyEventInput[]): BookDayState[] {
  const out: BookDayState[] = []
  let streakProdSoft = 0, streakProdHard = 0, streakSecSoft = 0, streakSecHard = 0
  for (const day of days) {
    const prodSoft = day.maxProdShare >= PRODUCT_SOFT
    const prodHard = day.maxProdShare >= PRODUCT_HARD
    const secSoft = day.maxSecShare >= SECTOR_SOFT
    const secHard = day.maxSecShare >= SECTOR_HARD
    streakProdSoft = prodSoft ? streakProdSoft + 1 : 0
    streakProdHard = prodHard ? streakProdHard + 1 : 0
    streakSecSoft = secSoft ? streakSecSoft + 1 : 0
    streakSecHard = secHard ? streakSecHard + 1 : 0
    const persistHard = streakProdHard >= PERSIST_DAYS || streakSecHard >= PERSIST_DAYS
    const persistSoft = streakProdSoft >= PERSIST_DAYS || streakSecSoft >= PERSIST_DAYS
    const posUp = day.driver === "position" && (day.attrPos ?? 0) > 0
    const varBudget = Boolean(day.capOk && day.varPct != null && day.varPct > VAR_BUDGET_SOFT)
    const freeze = day.driver === "market"
    const flags: Record<string, boolean> = {
      prod_soft: prodSoft,
      prod_hard: prodHard,
      sec_soft: secSoft,
      sec_hard: secHard,
      persist_hard: persistHard,
      persist_soft: persistSoft,
      pos_up: posUp,
      var_budget: varBudget,
      ...day.flags,
    }
    const signs = ALL_SIGN_KEYS.filter((key) => Boolean(flags[key]))
    const action = classifyBookAction({
      prodSoft, prodHard, secSoft, secHard, persistHard, persistSoft,
      streakProdSoft, streakSecSoft, posUp, varBudget, freeze, nSigns: signs.length,
    })
    out.push({
      ...day,
      prodSoft, prodHard, secSoft, secHard, posUp, varBudget,
      streakProdSoft, streakProdHard, streakSecSoft, streakSecHard,
      persistHard, persistSoft, freeze,
      signs,
      signsCn: signs.map((key) => SIGN_LABELS[key] ?? key),
      nSigns: signs.length,
      action,
      actionDisplay: annotateAction(action, {
        prodHard, secHard, freeze, persistHard,
        streakProdHard, streakSecHard, jump: Boolean(day.flags.jump),
      }),
      driverLabel: "",
    })
  }
  return out
}

/**
 * Episode window ending at asOfIndex: stitch soft-line pulses with small gaps,
 * add a short lead-in, and always keep at least a recent context slice.
 */
export function episodeWindowIndices(
  shares: readonly number[],
  soft: number,
  asOfIndex: number,
  options?: { gap?: number; leadIn?: number; minDays?: number; maxDays?: number },
): { start: number; end: number } {
  const gap = options?.gap ?? EVENT_GAP_DAYS
  const leadIn = options?.leadIn ?? EVENT_LEADIN_DAYS
  const minDays = options?.minDays ?? EVENT_MIN_DAYS
  const maxDays = options?.maxDays ?? EVENT_MAX_DAYS
  if (asOfIndex < 0 || shares.length === 0) return { start: 0, end: Math.max(0, shares.length - 1) }
  const end = asOfIndex
  let start = end
  let below = 0
  let seenSoft = false
  for (let i = end; i >= 0; i -= 1) {
    if ((shares[i] ?? 0) >= soft) {
      start = i
      below = 0
      seenSoft = true
    } else {
      below += 1
      if (seenSoft && below > gap) break
      if (!seenSoft && end - i + 1 >= minDays) {
        start = i
        break
      }
    }
    if (i === 0) start = seenSoft ? start : 0
  }
  start = Math.max(0, start - leadIn)
  if (end - start + 1 < minDays) start = Math.max(0, end - minDays + 1)
  if (end - start + 1 > maxDays) start = end - maxDays + 1
  return { start, end }
}

export function formatWan(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const sign = value < 0 ? "-" : ""
  return `${sign}${(Math.abs(value) / 10_000).toFixed(digits)}万`
}

export function formatSharePct(sharePct: number, short?: boolean): string {
  const text = `${(Math.round(sharePct * 10) / 10).toFixed(1)}%`
  return short ? `${text}（空头）` : text
}

export function formatMdDate(date: string): string {
  if (date.length >= 10) return date.slice(5, 10)
  return date
}

export function firstProductText(code: string, sharePct: number): string {
  const name = prodLabel(code)
  // prodLabel is "MA（甲醇）"; the report writes "甲醇 23.3%"
  const cn = name.includes("（") ? name.slice(name.indexOf("（") + 1, name.indexOf("）")) : name
  return `${cn} ${formatSharePct(sharePct)}`
}


export function prodShortName(code: string): string {
  return PROD_NAMES[code] ?? code
}

export function nanQuantile(values: readonly (number | null | undefined)[], q: number): number | null {
  const xs = values.filter((value): value is number => value != null && Number.isFinite(value)).slice().sort((a, b) => a - b)
  if (xs.length === 0) return null
  if (xs.length === 1) return xs[0]
  const pos = (xs.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return xs[lo]
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)
}

export type RegimeMetrics = {
  medSigma: number | null
  dMedSigma: number | null
  meanCorr: number | null
  breadth: number | null
  gapMed: number | null
  jumpMed: number | null
  maxAbsR: number | null
  nLiqGap: number
  nSpike: number
}

export type RegimeFlags = {
  vol_spike: boolean
  corr_surge: boolean
  corr_collapse: boolean
  regime_breadth: boolean
  gap: boolean
  jump: boolean
  idiosyncratic: boolean
  liq: boolean
  roll: boolean
}

export type RegimeThresholds = {
  p95Sig: number | null
  p95Dsig: number | null
  p95Corr: number | null
  p05Corr: number | null
  p95Breadth: number | null
  p95Gap: number | null
  p95Jump: number | null
  p99Abs: number | null
}

export function regimeThresholds(matureMetrics: readonly RegimeMetrics[]): RegimeThresholds {
  return {
    p95Sig: nanQuantile(matureMetrics.map((row) => row.medSigma), 0.95),
    p95Dsig: nanQuantile(matureMetrics.map((row) => row.dMedSigma), 0.95),
    p95Corr: nanQuantile(matureMetrics.map((row) => row.meanCorr), 0.95),
    p05Corr: nanQuantile(matureMetrics.map((row) => row.meanCorr), 0.05),
    p95Breadth: nanQuantile(matureMetrics.map((row) => row.breadth), 0.95),
    p95Gap: nanQuantile(matureMetrics.map((row) => row.gapMed), 0.95),
    p95Jump: nanQuantile(matureMetrics.map((row) => row.jumpMed), 0.95),
    p99Abs: nanQuantile(matureMetrics.map((row) => row.maxAbsR), 0.99),
  }
}

function over(value: number | null | undefined, threshold: number | null, dir: "gte" | "lte" = "gte"): boolean {
  if (value == null || !Number.isFinite(value) || threshold == null || !Number.isFinite(threshold)) return false
  return dir === "gte" ? value >= threshold : value <= threshold
}

export function classifyRegimeFlags(metrics: RegimeMetrics, thresholds: RegimeThresholds): RegimeFlags {
  return {
    vol_spike: over(metrics.medSigma, thresholds.p95Sig) || over(metrics.dMedSigma, thresholds.p95Dsig),
    corr_surge: over(metrics.meanCorr, thresholds.p95Corr),
    corr_collapse: over(metrics.meanCorr, thresholds.p05Corr, "lte"),
    regime_breadth: over(metrics.breadth, thresholds.p95Breadth),
    gap: over(metrics.gapMed, thresholds.p95Gap),
    jump: over(metrics.jumpMed, thresholds.p95Jump),
    idiosyncratic: over(metrics.maxAbsR, thresholds.p99Abs),
    liq: metrics.nLiqGap >= 3,
    roll: metrics.nSpike >= 2,
  }
}

/** Share of finite observations at or below `x`, in percent. */
export function empiricalPercentile(values: readonly (number | null | undefined)[], x: number | null): number | null {
  if (x == null || !Number.isFinite(x)) return null
  const xs = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (xs.length === 0) return null
  return (xs.filter((value) => value <= x).length / xs.length) * 100
}

const NEAR_RATIO = 0.95
const CRITICAL_RATIO = 0.02
const LOW_CORR_PCT = 20

export type RegimeTrigger = "yes" | "near" | "no"

export type RegimeStatusRow = {
  key: string
  status: string
  rule: string
  trigger: RegimeTrigger
  triggerText: string
  meaning: string
}

export type RegimeStatusTable = {
  date: string
  dateLabel: string
  matureDays: number
  rows: RegimeStatusRow[]
}

function formatPctRatio(value: number | null, digits: number): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${(value * 100).toFixed(digits)}%`
}

function formatCorr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toFixed(3)
}

function pctilePhrase(pctile: number | null): string {
  if (pctile == null || !Number.isFinite(pctile)) return "分位不足"
  return `约 ${Math.round(pctile)}% 分位`
}

function isCritical(value: number | null, threshold: number | null): boolean {
  if (value == null || threshold == null || !Number.isFinite(value) || !Number.isFinite(threshold)) return false
  const scale = Math.max(Math.abs(threshold), 1e-6)
  return Math.abs(value - threshold) / scale <= CRITICAL_RATIO
}

function nearUpper(value: number | null, threshold: number | null): boolean {
  if (value == null || threshold == null || !Number.isFinite(value) || !Number.isFinite(threshold) || threshold <= 0) return false
  if (value >= threshold) return false
  return value / threshold >= NEAR_RATIO
}

function nearLower(value: number | null, threshold: number | null): boolean {
  if (value == null || threshold == null || !Number.isFinite(value) || !Number.isFinite(threshold) || threshold <= 0) return false
  if (value <= threshold) return false
  return value / threshold <= 1 + (1 - NEAR_RATIO)
}

function statusOf(on: boolean, near: boolean): RegimeTrigger {
  if (on) return "yes"
  if (near) return "near"
  return "no"
}

function triggerSentence(kind: RegimeTrigger, detail: string, critical = false): string {
  if (kind === "yes" && critical) return "是（临界触发）"
  if (kind === "yes") return `是（${detail}）`
  if (kind === "near") return `接近（${detail}），未达阈值`
  return `否（${detail}）`
}

function countSentence(count: number, limit: number): { trigger: RegimeTrigger; triggerText: string } {
  if (count >= limit) return { trigger: "yes", triggerText: `是（${count} 个）` }
  if (count === limit - 1) return { trigger: "near", triggerText: `接近（${count} 个），未达阈值` }
  return { trigger: "no", triggerText: `否（${count} 个）` }
}

/**
 * Chapter-5 market-state table for one trading day.
 * Thresholds are the mature-sample quantiles; the trigger cell is that day's reading.
 */
export function buildRegimeStatusTable(input: {
  date: string
  metrics: RegimeMetrics
  mature: readonly RegimeMetrics[]
}): RegimeStatusTable {
  const { metrics, mature } = input
  const thresholds = regimeThresholds(mature)
  const flags = classifyRegimeFlags(metrics, thresholds)
  const pct = {
    sig: empiricalPercentile(mature.map((row) => row.medSigma), metrics.medSigma),
    corr: empiricalPercentile(mature.map((row) => row.meanCorr), metrics.meanCorr),
    breadth: empiricalPercentile(mature.map((row) => row.breadth), metrics.breadth),
    gap: empiricalPercentile(mature.map((row) => row.gapMed), metrics.gapMed),
    jump: empiricalPercentile(mature.map((row) => row.jumpMed), metrics.jumpMed),
    abs: empiricalPercentile(mature.map((row) => row.maxAbsR), metrics.maxAbsR),
  }
  const dOn = over(metrics.dMedSigma, thresholds.p95Dsig)
  const volKind = statusOf(flags.vol_spike, nearUpper(metrics.medSigma, thresholds.p95Sig) || nearUpper(metrics.dMedSigma, thresholds.p95Dsig))
  const volDetail = `${formatPctRatio(metrics.medSigma, 2)}，${pctilePhrase(pct.sig)}；${dOn ? "一日增量达 95% 分位" : "增量未达 95%"}`
  const corrLow = flags.corr_collapse || (pct.corr != null && pct.corr <= LOW_CORR_PCT)
  const corrSurgeKind = statusOf(flags.corr_surge, nearUpper(metrics.meanCorr, thresholds.p95Corr))
  const corrCollapseKind = statusOf(flags.corr_collapse, nearLower(metrics.meanCorr, thresholds.p05Corr))
  const breadthKind = statusOf(flags.regime_breadth, nearUpper(metrics.breadth, thresholds.p95Breadth))
  const gapKind = statusOf(flags.gap, nearUpper(metrics.gapMed, thresholds.p95Gap))
  const jumpKind = statusOf(flags.jump, nearUpper(metrics.jumpMed, thresholds.p95Jump))
  const shockKind = statusOf(flags.idiosyncratic, nearUpper(metrics.maxAbsR, thresholds.p99Abs))
  const shockDetail = shockKind === "no"
    ? `最大约 ${formatPctRatio(metrics.maxAbsR, 1)}`
    : `最大约 ${formatPctRatio(metrics.maxAbsR, 1)}，${pctilePhrase(pct.abs)}`
  const liq = countSentence(metrics.nLiqGap, 3)
  const roll = countSentence(metrics.nSpike, 2)

  const rows: RegimeStatusRow[] = [
    {
      key: "vol_spike",
      status: "波动抬升",
      rule: `持仓品种 20 日 σ 中位数 ≥ 95% 分位（${formatPctRatio(thresholds.p95Sig, 2)}），或其中位数一日增量 ≥ 95% 分位`,
      trigger: volKind,
      triggerText: triggerSentence(volKind, volDetail, false),
      meaning: "不因市场波动升高而砍仓；可冻结硬阈值、加强观察",
    },
    {
      key: "corr_surge",
      status: "高相关传染",
      rule: `持仓品种 252 日平均两两相关 ≥ 95% 分位（约 ${formatCorr(thresholds.p95Corr)}）`,
      trigger: corrSurgeKind,
      triggerText: !flags.corr_surge && corrLow
        ? `否（${formatCorr(metrics.meanCorr)}，反而是低相关）`
        : triggerSentence(corrSurgeKind, `${formatCorr(metrics.meanCorr)}，${pctilePhrase(pct.corr)}`, isCritical(metrics.meanCorr, thresholds.p95Corr)),
      meaning: "高相关时同样的贡献占比更危险，可临时收紧软预警",
    },
    {
      key: "corr_collapse",
      status: "相关塌缩",
      rule: `持仓品种平均两两相关 ≤ 5% 分位（约 ${formatCorr(thresholds.p05Corr)}）`,
      trigger: corrCollapseKind,
      triggerText: triggerSentence(
        corrCollapseKind,
        `${formatCorr(metrics.meanCorr)}，${pctilePhrase(pct.corr)}`,
        isCritical(metrics.meanCorr, thresholds.p05Corr),
      ),
      meaning: "分散化改善，通常不应收紧贡献上限",
    },
    {
      key: "regime_breadth",
      status: "截面同向",
      rule: `当日持仓品种收益同向占比 ≥ 95% 分位（约 ${formatPctRatio(thresholds.p95Breadth, 1)}）`,
      trigger: breadthKind,
      triggerText: triggerSentence(
        breadthKind,
        `${formatPctRatio(metrics.breadth, 1)}，${pctilePhrase(pct.breadth)}`,
        isCritical(metrics.breadth, thresholds.p95Breadth),
      ),
      meaning: "「万物同向」日观察隔夜与板块上限，仍不以市场为由砍仓",
    },
    {
      key: "gap",
      status: "隔夜缺口",
      rule: `持仓品种开盘相对前结算的缺口中位数 ≥ 95% 分位（约 ${formatPctRatio(thresholds.p95Gap, 2)}）`,
      trigger: gapKind,
      triggerText: triggerSentence(
        gapKind,
        `${formatPctRatio(metrics.gapMed, 2)}，${pctilePhrase(pct.gap)}`,
        isCritical(metrics.gapMed, thresholds.p95Gap),
      ),
      meaning: "关注跳空是否来自商品自身事件；不自动减仓",
    },
    {
      key: "jump",
      status: "收益跳跃",
      rule: `持仓品种 |收益| 中位数 ≥ 95% 分位（约 ${formatPctRatio(thresholds.p95Jump, 2)}）`,
      trigger: jumpKind,
      triggerText: triggerSentence(
        jumpKind,
        `${formatPctRatio(metrics.jumpMed, 2)}，${pctilePhrase(pct.jump)}`,
        isCritical(metrics.jumpMed, thresholds.p95Jump),
      ),
      meaning: "与波动抬升类似，先定性再决定是否观察仓位",
    },
    {
      key: "idiosyncratic",
      status: "个品种冲击",
      rule: `持仓品种最大 |收益| ≥ 99% 分位（约 ${formatPctRatio(thresholds.p99Abs, 1)}）`,
      trigger: shockKind,
      triggerText: triggerSentence(shockKind, shockDetail, isCritical(metrics.maxAbsR, thresholds.p99Abs)),
      meaning: "若冲击来自单一商品事件，检查该品种持仓是否被动放大；仅在持仓同步扩张时升级",
    },
    {
      key: "liq",
      status: "流动性缺口",
      rule: "成交量低于 20 日中位数 30% 的持仓品种数 ≥ 3",
      trigger: liq.trigger,
      triggerText: liq.triggerText,
      meaning: "流动性差时更不宜强迫减仓（冲击成本高），应放宽执行时限",
    },
    {
      key: "roll",
      status: "移仓/异常跳价",
      rule: "系统 MAD 规则标记的跳价品种数 ≥ 2",
      trigger: roll.trigger,
      triggerText: roll.triggerText,
      meaning: "优先检查连续合约与近月切换是否污染 σ，而非干预策略",
    },
  ]

  return {
    date: input.date,
    dateLabel: formatMdDate(input.date),
    matureDays: mature.length,
    rows,
  }
}

export type EventTableRow = {
  date: string
  dateShort: string
  sharePct: number
  shareText: string
  secondPct: number
  secondText: string
  driver: DriverKind
  driverLabel: string
  dVar: number | null
  dVarText: string
  varPct: number | null
  varPctText: string
  nSigns: number
  signs: string[]
  signsCn: string[]
  action: BookAction
  actionDisplay: string
}

export type EventTableBlock = {
  kind: "product" | "sector"
  name: string
  label: string
  shareHeader: string
  secondHeader: string
  windowFrom: string
  windowTo: string
  asOfSharePct: number
  rows: EventTableRow[]
}

export type EventTablesPayload = {
  ok: true
  date: string
  latestDate: string
  selectedDate: string
  productTable: EventTableBlock | null
  sectorTable: EventTableBlock | null
  regimeTable: RegimeStatusTable | null
  footnote: string
  volDays: number
  corrDays: number
  window: "inclusive"
}

export { PRODUCT_SOFT, PRODUCT_HARD, SECTOR_SOFT, SECTOR_HARD, sectorLabel, prodLabel }
