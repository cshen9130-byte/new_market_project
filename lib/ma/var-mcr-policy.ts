/** Agreed MOM-lite concentration and account-layer rules for the live suggestion panel. */

import { PROD_NAMES, PROD_SECTOR, prodLabel } from "@/lib/ma/prod-sector"
import { varConcentrationShares } from "@/lib/mom-var-concentration"

export const PRODUCT_SOFT = 30
export const PRODUCT_HARD = 50
export const SECTOR_SOFT = 50
export const SECTOR_HARD = 65
export const VAR_BUDGET_SOFT = 2.07
export const VAR_BUDGET_HARD = 5
export const PERSIST_DAYS = 3
export const NNR_RELEASE_DAYS = 3
export const WARN_BAND_PP = 2
export const ACCOUNT_CAP_MIN = 1_000_000
export const BOOK_CAP_MIN = 10_000_000
export const MV_MIN = 1_000
export const CUT_COVERAGE = 0.9
export const CUT_MIN_SHARE = 0.05

export const SECTOR_DISPLAY: Record<string, string> = { 农产: "农产品" }

export type ObjectKind = "product" | "sector"
export type Stance = "观察" | "禁止新增" | "建议减仓"
export type DriverKind = "position" | "market" | "flat" | "na"

export type DriverInfo = {
  driver: DriverKind
  dVar: number | null
  attrPos: number | null
  attrMkt: number | null
}

export type BreachRow = {
  kind: ObjectKind
  name: string
  label: string
  sharePct: number
  softPct: number
  hardPct: number
  overSoft: boolean
  overHard: boolean
  softStreak: number
  hardStreak: number
  nnrAlreadyInEffect: boolean
  nnrStartsNextSession: boolean
  hardCutEligible: boolean
  frozenHard: boolean
  stance: Stance
  formalCut: boolean
  illustrationOnly: boolean
}

export type HolderRow = {
  account: string
  accountDisp: string
  traderName: string | null
  displayName: string
  prod: string
  prodLabel: string
  sector: string
  netMv: number
  grossMv: number
  netLots: number
  grossLots: number
  shareOfObject: number
  shareOfAccount: number
}

export type CutRow = {
  account: string
  accountDisp: string
  traderName: string | null
  displayName: string
  prod: string
  prodLabel: string
  currentMv: number
  targetMv: number
  cutAbsMv: number
  currentLots: number
  targetLots: number
  cutLots: number
  shareOfObject: number
  direction: "long" | "short" | "flat"
  residual: boolean
}

export type AccountLayerAction = {
  account: string
  accountDisp: string
  traderName: string | null
  displayName: string
  asOfDate: string
  equity: number | null
  capital: number | null
  ratio: number | null
  warnPct: number | null
  stopPct: number | null
  warningStopLoss: string | null
  nearWarn: boolean
  warnHit: boolean
  stopHit: boolean
  stillTrading: boolean
  action: "限制该账户新增" | "升级投资经理" | null
  note: string
}

export type EquityFlowRow = {
  date: string
  equity: number | null
  netFlow: number
  pnl?: number | null
}

export type CapitalState = {
  date: string
  equity: number | null
  netFlow: number
  capital: number
  capitalBefore: number
  ratio: number | null
  ratioBefore: number | null
  isWithdrawal: boolean
  warnPct: number | null
  stopPct: number | null
  warnHit: boolean
  stopHit: boolean
  nearWarn: boolean
}

export function asDate(value: string | null | undefined): string {
  return (value ?? "").slice(0, 10)
}

export function normAccount(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "")
}

export function displayAccount(value: string | null | undefined): string {
  const raw = (value ?? "").trim()
  const norm = normAccount(raw)
  if (norm.startsWith("rx") && /^\d+$/.test(norm.slice(2))) return `RX${norm.slice(2)}`
  return raw || norm
}

export function personLabel(name: string | null | undefined, account: string): string {
  const disp = displayAccount(account)
  const trimmed = (name ?? "").trim()
  if (!trimmed) return `${disp}（对照表中无姓名）`
  return `${trimmed}（${disp}）`
}

export function sectorLabel(name: string): string {
  return SECTOR_DISPLAY[name] ?? name
}

export function objectLabel(kind: ObjectKind, name: string): string {
  return kind === "product" ? prodLabel(name) : sectorLabel(name)
}

export function parseWarningStop(text: string | null | undefined): { warnPct: number | null; stopPct: number | null } {
  if (!text) return { warnPct: null, stopPct: null }
  const match = String(text).match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/)
  if (!match) return { warnPct: null, stopPct: null }
  return { warnPct: Number(match[1]) / 100, stopPct: Number(match[2]) / 100 }
}

export function trailingStreak(values: number[], threshold: number): number {
  let count = 0
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] >= threshold) count += 1
    else break
  }
  return count
}

export function linearScaleK(sharePct: number, targetPct: number): number {
  if (!(sharePct > targetPct + 1e-12)) return 1
  return targetPct / sharePct
}

export function classifyDriver(attrPos: number | null, attrMkt: number | null): DriverKind {
  if (attrPos == null || attrMkt == null) return "na"
  if (Math.abs(attrPos) < 1e-9 && Math.abs(attrMkt) < 1e-9) return "flat"
  return Math.abs(attrPos) >= Math.abs(attrMkt) ? "position" : "market"
}

export function shapleyDriver(v00: number, v10: number, v01: number, v11: number): DriverInfo {
  const attrPos = 0.5 * ((v10 - v00) + (v11 - v01))
  const attrMkt = 0.5 * ((v01 - v00) + (v11 - v10))
  const dVar = v11 - v00
  return { driver: classifyDriver(attrPos, attrMkt), dVar, attrPos, attrMkt }
}

export type VarProduct = { prod: string; mv: number; sigma: number }

export function portfolioVariance(products: readonly VarProduct[], corr: readonly (readonly number[])[]): number {
  const dv = products.map((product) => product.sigma * product.mv)
  let sum = 0
  for (let i = 0; i < dv.length; i += 1) {
    if (dv[i] === 0) continue
    for (let j = 0; j < dv.length; j += 1) {
      if (dv[j] === 0) continue
      sum += dv[i] * dv[j] * (corr[i]?.[j] ?? 0)
    }
  }
  return sum
}

export function portfolioVar95(products: readonly VarProduct[], corr: readonly (readonly number[])[], z = 1.6449): number {
  const variance = portfolioVariance(products, corr)
  return variance > 0 ? z * Math.sqrt(variance) : 0
}

export function objectSharePct(products: readonly VarProduct[], corr: readonly (readonly number[])[], kind: ObjectKind, name: string): number {
  const shares = varConcentrationShares(products, corr)
  const list = kind === "product" ? shares.products : shares.sectors
  return list.find((item) => item.name === name)?.pct ?? 0
}

export function scaleProducts(products: readonly VarProduct[], names: ReadonlySet<string>, k: number): VarProduct[] {
  return products.map((product) => names.has(product.prod) ? { ...product, mv: product.mv * k } : { ...product })
}

/** Bisect k so the object's MCR share returns to the soft line. */
export function bisectScaleK(input: {
  products: readonly VarProduct[]
  corr: readonly (readonly number[])[]
  kind: ObjectKind
  name: string
  targetPct: number
}): { k: number; achievedShare: number; applied: boolean } {
  const { products, corr, kind, name, targetPct } = input
  const names = kind === "product"
    ? new Set([name])
    : new Set(products.filter((product) => (PROD_SECTOR[product.prod] ?? "其他") === name).map((product) => product.prod))
  const share0 = objectSharePct(products, corr, kind, name)
  if (share0 <= targetPct + 1e-12) return { k: 1, achievedShare: share0, applied: false }

  let lo = 0
  let hi = 1
  let bestK = targetPct / share0
  let bestShare = share0
  for (let i = 0; i < 14; i += 1) {
    const mid = 0.5 * (lo + hi)
    const share = objectSharePct(scaleProducts(products, names, mid), corr, kind, name)
    bestK = mid
    bestShare = share
    if (share > targetPct) hi = mid
    else lo = mid
    if (Math.abs(share - targetPct) <= 0.3) break
  }
  return { k: bestK, achievedShare: bestShare, applied: bestK < 1 - 1e-12 }
}

export function classifyBreach(input: {
  kind: ObjectKind
  name: string
  sharePct: number
  softStreak: number
  hardStreak: number
  driver: DriverKind
  attrPos: number | null
  varPct: number | null
  capOk: boolean
}): BreachRow {
  const softPct = input.kind === "product" ? PRODUCT_SOFT : SECTOR_SOFT
  const hardPct = input.kind === "product" ? PRODUCT_HARD : SECTOR_HARD
  const overSoft = input.sharePct >= softPct
  const overHard = input.sharePct >= hardPct
  const varBudget = Boolean(input.capOk && input.varPct != null && input.varPct > VAR_BUDGET_SOFT)
  const posUp = input.driver === "position" && (input.attrPos ?? 0) > 0
  const freeze = input.driver === "market"
  const persistHard = input.hardStreak >= PERSIST_DAYS
  const hardCutRaw = persistHard && (posUp || varBudget)
  const hardCutEligible = hardCutRaw && !freeze
  const frozenHard = hardCutRaw && freeze
  let stance: Stance = "观察"
  if (hardCutEligible) stance = "建议减仓"
  else if (overSoft) stance = "禁止新增"
  return {
    kind: input.kind,
    name: input.name,
    label: objectLabel(input.kind, input.name),
    sharePct: round1(input.sharePct),
    softPct,
    hardPct,
    overSoft,
    overHard,
    softStreak: input.softStreak,
    hardStreak: input.hardStreak,
    nnrAlreadyInEffect: overSoft && input.softStreak >= 2,
    nnrStartsNextSession: overSoft,
    hardCutEligible,
    frozenHard,
    stance,
    formalCut: hardCutEligible,
    illustrationOnly: overSoft && !hardCutEligible,
  }
}

export function collectBreaches(input: {
  productSeries: Record<string, number[]>
  sectorSeries: Record<string, number[]>
  asOfIndex: number
  driver: DriverKind
  attrPos: number | null
  varPct: number | null
  capOk: boolean
}): BreachRow[] {
  const rows: BreachRow[] = []
  for (const [name, series] of Object.entries(input.productSeries)) {
    const sharePct = series[input.asOfIndex] ?? 0
    if (sharePct < PRODUCT_SOFT) continue
    const prefix = series.slice(0, input.asOfIndex + 1)
    rows.push(classifyBreach({
      kind: "product",
      name,
      sharePct,
      softStreak: trailingStreak(prefix, PRODUCT_SOFT),
      hardStreak: trailingStreak(prefix, PRODUCT_HARD),
      driver: input.driver,
      attrPos: input.attrPos,
      varPct: input.varPct,
      capOk: input.capOk,
    }))
  }
  for (const [name, series] of Object.entries(input.sectorSeries)) {
    const sharePct = series[input.asOfIndex] ?? 0
    if (sharePct < SECTOR_SOFT) continue
    const prefix = series.slice(0, input.asOfIndex + 1)
    rows.push(classifyBreach({
      kind: "sector",
      name,
      sharePct,
      softStreak: trailingStreak(prefix, SECTOR_SOFT),
      hardStreak: trailingStreak(prefix, SECTOR_HARD),
      driver: input.driver,
      attrPos: input.attrPos,
      varPct: input.varPct,
      capOk: input.capOk,
    }))
  }
  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "product" ? -1 : 1
    return b.sharePct - a.sharePct
  })
  return rows
}

export function productsToScale(kind: ObjectKind, name: string, allProducts: readonly string[]): string[] {
  if (kind === "product") return [name]
  return allProducts.filter((prod) => (PROD_SECTOR[prod] ?? "其他") === name)
}

/**
 * Allocate a book-level k across accounts, proportional to |net MV|.
 * Tiny residual holders stay on the holder list but are not given a cut order
 * unless they are needed to reach 90% coverage or have at least 5% of the object.
 */
export function allocateCuts(input: {
  k: number
  holders: readonly HolderRow[]
  products: readonly string[]
}): { included: CutRow[]; residual: CutRow[]; k: number } {
  const k = Math.max(0, Math.min(1, input.k))
  const relevant = input.holders.filter((row) => input.products.includes(row.prod) && Math.abs(row.netMv) >= MV_MIN)
  const objectGross = relevant.reduce((sum, row) => sum + Math.abs(row.netMv), 0)
  const byAccount = new Map<string, number>()
  for (const row of relevant) {
    byAccount.set(row.account, (byAccount.get(row.account) ?? 0) + Math.abs(row.netMv))
  }
  const ranked = [...byAccount.entries()].sort((a, b) => b[1] - a[1])
  const includedAccounts = new Set<string>()
  let covered = 0
  for (const [account, absMv] of ranked) {
    const share = objectGross > 0 ? absMv / objectGross : 0
    if (includedAccounts.size === 0 || share >= CUT_MIN_SHARE || covered < CUT_COVERAGE) {
      includedAccounts.add(account)
      covered += share
    }
  }
  const toCut = (row: HolderRow, residual: boolean): CutRow => {
    const currentMv = row.netMv
    const targetMv = currentMv * k
    const cutAbsMv = Math.abs(currentMv) * (1 - k)
    const currentLots = row.netLots
    const absLots = Math.abs(currentLots)
    const rawCutLots = absLots > 0 ? (1 - k) * absLots : 0
    const cutLots = absLots > 0 ? Math.min(absLots, Math.max(0, Math.ceil(rawCutLots - 1e-9))) : 0
    const sign = currentLots > 0 ? 1 : currentLots < 0 ? -1 : currentMv > 0 ? 1 : currentMv < 0 ? -1 : 0
    const targetLots = sign * (absLots - cutLots)
    return {
      account: row.account,
      accountDisp: row.accountDisp,
      traderName: row.traderName,
      displayName: row.displayName,
      prod: row.prod,
      prodLabel: row.prodLabel || prodLabel(row.prod),
      currentMv: Math.round(currentMv),
      targetMv: Math.round(targetMv),
      cutAbsMv: Math.round(cutAbsMv),
      currentLots: Math.round(currentLots),
      targetLots: Math.round(targetLots),
      cutLots,
      shareOfObject: objectGross > 0 ? Math.abs(currentMv) / objectGross : 0,
      direction: currentMv > 0 ? "long" : currentMv < 0 ? "short" : "flat",
      residual,
    }
  }
  const included: CutRow[] = []
  const residual: CutRow[] = []
  const sorted = [...relevant].sort((a, b) => Math.abs(b.netMv) - Math.abs(a.netMv))
  for (const row of sorted) {
    const item = toCut(row, !includedAccounts.has(row.account))
    if (item.residual) residual.push(item)
    else included.push(item)
  }
  return { included, residual, k }
}

export function buildCapitalPath(
  rows: readonly EquityFlowRow[],
  warnPct: number | null,
  stopPct: number | null,
  capMin = ACCOUNT_CAP_MIN,
): CapitalState[] {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const out: CapitalState[] = []
  let cum = 0
  for (const row of ordered) {
    const flow = Number.isFinite(row.netFlow) ? row.netFlow : 0
    const equity = row.equity == null || !Number.isFinite(row.equity) ? null : row.equity
    const capitalBefore = cum
    cum = cum + flow
    const ratio = equity != null && cum > 0 ? equity / cum : null
    const eqBefore = equity != null ? equity - flow : null
    const ratioBefore = eqBefore != null && capitalBefore > 0 ? eqBefore / capitalBefore : null
    const isWithdrawal = flow < -1
    const hit = (th: number | null, ratioNow: number | null, ratioPre: number | null, capNow: number) => {
      if (th == null || ratioNow == null || capNow < capMin) return false
      if (ratioNow > th) return false
      if (isWithdrawal) {
        if (ratioPre == null) return false
        return ratioPre <= th
      }
      return true
    }
    const warnHit = hit(warnPct, ratio, ratioBefore, cum)
    const stopHit = hit(stopPct, ratio, ratioBefore, cum)
    const nearWarn = Boolean(
      warnPct != null
      && ratio != null
      && cum >= capMin
      && !warnHit
      && !stopHit
      && ratio > warnPct
      && ratio <= warnPct + WARN_BAND_PP / 100,
    )
    out.push({
      date: row.date,
      equity,
      netFlow: flow,
      capital: cum,
      capitalBefore,
      ratio,
      ratioBefore,
      isWithdrawal,
      warnPct,
      stopPct,
      warnHit,
      stopHit,
      nearWarn,
    })
  }
  return out
}

export function accountLayerNote(state: CapitalState, stillTrading: boolean): { action: AccountLayerAction["action"]; note: string } {
  const ratioTxt = state.ratio != null ? `${(state.ratio * 100).toFixed(2)}%` : "—"
  const warnTxt = state.warnPct != null ? `${(state.warnPct * 100).toFixed(0)}%` : "—"
  const stopTxt = state.stopPct != null ? `${(state.stopPct * 100).toFixed(0)}%` : "—"
  if (state.stopHit) {
    const action: AccountLayerAction["action"] = stillTrading ? "升级投资经理" : "限制该账户新增"
    const note = stillTrading
      ? `权益/净入金 ${ratioTxt}，已跌破该账户止损线 ${stopTxt}，且仍有持仓。建议当晚升级投资经理，讨论暂停新增、收缩或退出安排。不把首次触及写成自动清仓。`
      : `权益/净入金 ${ratioTxt}，已跌破该账户止损线 ${stopTxt}。建议具名沟通；不把首次触及写成自动清仓。`
    return { action, note }
  }
  if (state.warnHit) {
    return {
      action: "限制该账户新增",
      note: `权益/净入金 ${ratioTxt}，已触及该账户预警线 ${warnTxt}。建议当晚具名沟通，并只对该账户限制新增风险。`,
    }
  }
  if (state.nearWarn) {
    return {
      action: "限制该账户新增",
      note: `权益/净入金 ${ratioTxt}，已进入该账户预警线 ${warnTxt} 上方 2 个百分点以内。建议当晚具名沟通，并只对该账户限制新增风险。`,
    }
  }
  return { action: null, note: "" }
}

export function budgetSoftNote(varPct: number | null, capOk: boolean): string | null {
  if (!capOk || varPct == null) return null
  if (varPct > VAR_BUDGET_SOFT) {
    return `组合 1 日 95% VaR/资本 ${varPct.toFixed(2)}%，已过软预算 ${VAR_BUDGET_SOFT}%。当晚沟通，并可限制新增风险，但不对整本账做自动封顶。`
  }
  return null
}

export function budgetHardNote(input: { varPct: number | null; capOk: boolean; hardStreak: number; lastFireDate?: string | null; releaseStreak?: number | null }): string | null {
  if (!input.capOk || input.varPct == null) return null
  if (input.hardStreak >= PERSIST_DAYS && input.varPct > VAR_BUDGET_HARD) {
    return `VaR/资本已连续 ${input.hardStreak} 个交易日超过 ${VAR_BUDGET_HARD}%。按预算硬闸门：收盘确认后，次日起把整本账按同一比例缩放到 ${VAR_BUDGET_SOFT}%。此条不受市场驱动冻结。`
  }
  if (input.lastFireDate && (input.releaseStreak == null || input.releaseStreak < PERSIST_DAYS)) {
    return `预算硬闸门最近一次在 ${input.lastFireDate} 收盘满足连续 ${PERSIST_DAYS} 日超过 ${VAR_BUDGET_HARD}% 的开火条件，解除前（反事实组合连续 ${PERSIST_DAYS} 日回到 ${VAR_BUDGET_HARD}% 及以下）应保持按 ${VAR_BUDGET_SOFT}% 缩仓后的总敞口，交易员可在解除后再加仓。`
  }
  return null
}

export function buildConclusion(input: {
  date: string
  breaches: readonly BreachRow[]
  varPct: number | null
  capOk: boolean
  driver: DriverKind
  budgetSoft?: string | null
  budgetHard?: string | null
}): string {
  if (input.breaches.length === 0) {
    const extras = [input.budgetSoft, input.budgetHard].filter(Boolean)
    const base = `${input.date}：最新日无品种/板块软预警突破，无需禁止新增或减仓。`
    return extras.length ? `${base}${extras.join("")}` : base
  }
  const parts = input.breaches.map((row) => {
    const streakTxt = row.softStreak <= 1 ? "第 1 个交易日" : `连续 ${row.softStreak} 个交易日`
    const line = row.overHard ? `已过${row.kind === "product" ? "品种" : "板块"}硬线` : `已过${row.kind === "product" ? "品种" : "板块"}软预警`
    return `${row.label} ${fmtPct(row.sharePct)}%，${line}（${streakTxt}）`
  })
  const nnrBits: string[] = []
  for (const row of input.breaches) {
    if (row.nnrAlreadyInEffect) nnrBits.push(`${row.label}自上一交易日收盘后已禁止加仓`)
    else if (row.nnrStartsNextSession) nnrBits.push(`次日起${row.label}禁止加仓`)
  }
  const formal = input.breaches.filter((row) => row.formalCut)
  const frozen = input.breaches.filter((row) => row.frozenHard)
  let cutTxt = "尚未达到 3 日持续 + 硬线，不做正式硬砍。"
  if (formal.length > 0) {
    cutTxt = formal.map((row) => `${row.label}已满足正式硬砍条件，建议把贡献压回软线 ${row.softPct}%。`).join("")
  } else if (frozen.length > 0) {
    cutTxt = "硬线持续条件已满足，但当日 VaR 上升由市场驱动，集中度硬阈值冻结，只维持禁止新增，不下达数量减仓令。"
  }
  const driverTxt = input.driver === "market"
    ? "当日 VaR 变化主因是市场。"
    : input.driver === "position"
      ? "当日 VaR 变化主因是持仓。"
      : ""
  const extras = [input.budgetSoft, input.budgetHard].filter(Boolean)
  return `${input.date}：${parts.join("；")}。按规则：${nnrBits.join("；")}。${cutTxt}${driverTxt}${extras.join("")}`
}

export function formatYuan(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} 万元`
  return `${sign}${abs.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 元`
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`
}

export function formatRatioPct(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${(value * 100).toFixed(digits)}%`
}

function fmtPct(value: number): string {
  return `${(Math.round(value * 10) / 10).toFixed(1)}`
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function productName(code: string): string {
  return PROD_NAMES[code] ?? code
}

export function productSector(code: string): string {
  return PROD_SECTOR[code] ?? "其他"
}
