import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import type { FundNavCorrectionRule } from "@/lib/fund-nav-correction-rules-types"
import { getServerStoragePath } from "@/lib/server/storage"

export type FundNavSeriesContext = {
  beian_hao?: string | null
  product_name?: string | null
  short_name?: string | null
}

export type LegacyNavRowLike = {
  price_date: string
}

const REPO_RULES_DIR = path.join(process.cwd(), "data", "fund-nav-correction-rules")

function storageRulesDir(): string {
  return getServerStoragePath("fund_nav_correction_rules")
}

function normalizeDate(value: string): string {
  const trimmed = (value ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const m = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/)
  if (!m) return trimmed
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}

function parseRuleFile(raw: string, fallbackBeian: string): FundNavCorrectionRule | null {
  try {
    const parsed = JSON.parse(raw) as Partial<FundNavCorrectionRule>
    const beian = (parsed.beian_hao ?? fallbackBeian).trim().toUpperCase()
    const start = normalizeDate(parsed.series_start_date ?? "")
    if (!beian || !start) return null
    return {
      beian_hao: beian,
      product_names: Array.isArray(parsed.product_names)
        ? parsed.product_names.map((n) => String(n).trim()).filter(Boolean)
        : [],
      series_start_date: start,
      preserve_high_nav_scale: parsed.preserve_high_nav_scale === true,
      note: typeof parsed.note === "string" ? parsed.note : "",
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : undefined,
    }
  } catch {
    return null
  }
}

function loadRulesFromDir(dir: string): FundNavCorrectionRule[] {
  if (!existsSync(dir)) return []
  const out: FundNavCorrectionRule[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue
    const fallbackBeian = file.replace(/\.json$/i, "").trim().toUpperCase()
    const raw = readFileSync(path.join(dir, file), "utf-8")
    const rule = parseRuleFile(raw, fallbackBeian)
    if (rule) out.push(rule)
  }
  return out
}

let rulesCache: FundNavCorrectionRule[] | null = null
let rulesCacheAt = 0
const RULES_CACHE_MS = 30_000

function allRules(): FundNavCorrectionRule[] {
  const now = Date.now()
  if (rulesCache && now - rulesCacheAt < RULES_CACHE_MS) return rulesCache

  const byBeian = new Map<string, FundNavCorrectionRule>()
  for (const rule of loadRulesFromDir(REPO_RULES_DIR)) {
    byBeian.set(rule.beian_hao.toUpperCase(), rule)
  }
  for (const rule of loadRulesFromDir(storageRulesDir())) {
    byBeian.set(rule.beian_hao.toUpperCase(), rule)
  }

  rulesCache = [...byBeian.values()]
  rulesCacheAt = now
  return rulesCache
}

export function invalidateFundNavCorrectionRulesCache(): void {
  rulesCache = null
  rulesCacheAt = 0
}

function identifierMatchesRule(identifier: string, rule: FundNavCorrectionRule): boolean {
  const id = identifier.trim()
  if (!id) return false
  if (id.toUpperCase() === rule.beian_hao.toUpperCase()) return true
  for (const alias of rule.product_names ?? []) {
    if (id === alias) return true
  }
  return false
}

export function lookupFundNavCorrectionRule(
  beian?: string | null,
  productName?: string | null,
  shortName?: string | null,
): FundNavCorrectionRule | null {
  const nameCandidates = [productName, shortName]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)

  for (const rule of allRules()) {
    if (nameCandidates.some((id) => identifierMatchesRule(id, rule))) return rule
  }

  const beianCode = (beian ?? "").trim().toUpperCase()
  if (beianCode) {
    return allRules().find((r) => r.beian_hao.toUpperCase() === beianCode) ?? null
  }
  return null
}

export function shouldSkipReturnIndexSanitize(context?: FundNavSeriesContext | null): boolean {
  if (!context) return false
  const rule = lookupFundNavCorrectionRule(
    context.beian_hao,
    context.product_name,
    context.short_name,
  )
  return rule?.preserve_high_nav_scale === true
}

export function applyFundNavCorrectionToLegacyRows<T extends LegacyNavRowLike>(
  rows: T[],
  context?: FundNavSeriesContext | null,
): T[] {
  if (!context || rows.length === 0) return rows
  const rule = lookupFundNavCorrectionRule(
    context.beian_hao,
    context.product_name,
    context.short_name,
  )
  if (!rule?.series_start_date) return rows

  const start = rule.series_start_date
  const trimmed = rows.filter((row) => row.price_date.slice(0, 10) >= start)
  return trimmed.length === rows.length ? rows : trimmed
}

export function getFundNavCorrectionRule(beianHao: string): FundNavCorrectionRule | null {
  const code = beianHao.trim().toUpperCase()
  if (!code) return null
  return allRules().find((r) => r.beian_hao.toUpperCase() === code) ?? null
}

export function listFundNavCorrectionRules(): FundNavCorrectionRule[] {
  return allRules().sort((a, b) => a.beian_hao.localeCompare(b.beian_hao))
}

export function saveFundNavCorrectionRule(
  rule: Omit<FundNavCorrectionRule, "updated_at">,
): FundNavCorrectionRule {
  const beian = rule.beian_hao.trim().toUpperCase()
  if (!beian) throw new Error("备案号不能为空")
  const start = normalizeDate(rule.series_start_date)
  if (!start) throw new Error("series_start_date 不能为空")

  const saved: FundNavCorrectionRule = {
    beian_hao: beian,
    product_names: (rule.product_names ?? []).map((n) => n.trim()).filter(Boolean),
    series_start_date: start,
    preserve_high_nav_scale: rule.preserve_high_nav_scale === true,
    note: rule.note ?? "",
    updated_at: new Date().toISOString(),
  }

  const dir = storageRulesDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${beian}.json`), JSON.stringify(saved, null, 2))
  invalidateFundNavCorrectionRulesCache()
  return saved
}

export function deleteFundNavCorrectionRule(beianHao: string): void {
  const code = beianHao.trim().toUpperCase()
  if (!code) return
  const file = path.join(storageRulesDir(), `${code}.json`)
  if (existsSync(file)) {
    unlinkSync(file)
  }
  invalidateFundNavCorrectionRulesCache()
}
