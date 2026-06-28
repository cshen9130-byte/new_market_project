import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import type { CustomFundNavGenerationRule } from "@/lib/custom-fund-nav-rules-types"
import { DEFAULT_SPLICE_FUNDS } from "@/lib/custom-fund-nav-rules-types"
import { assertCustomFundAccess } from "@/lib/server/custom-funds"
import { getServerStoragePath } from "@/lib/server/storage"

function rulesDir(): string {
  return getServerStoragePath("custom_funds", "nav_rules")
}

function rulesFile(productCode: string): string {
  return path.join(rulesDir(), `${productCode.trim()}.json`)
}

export function getCustomFundNavGenerationRule(productCode: string): CustomFundNavGenerationRule | null {
  const file = rulesFile(productCode)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as CustomFundNavGenerationRule
    return parsed
  } catch {
    return null
  }
}

export function saveCustomFundNavGenerationRule(
  productCode: string,
  rule: Omit<CustomFundNavGenerationRule, "updated_at">,
): CustomFundNavGenerationRule {
  mkdirSync(rulesDir(), { recursive: true })
  const saved: CustomFundNavGenerationRule = {
    rule_type: rule.rule_type,
    start_date: rule.start_date,
    funds: rule.funds,
    annual_return_rate: rule.annual_return_rate ?? "",
    mom_product_name: rule.mom_product_name ?? "",
    mom_fixed_item: rule.mom_fixed_item ?? "",
    mom_non_fixed_item: rule.mom_non_fixed_item ?? "",
    mom_extra_dates: Array.isArray(rule.mom_extra_dates) ? rule.mom_extra_dates : [],
    updated_at: new Date().toISOString(),
  }
  writeFileSync(rulesFile(productCode), JSON.stringify(saved, null, 2))
  return saved
}

export function clearCustomFundNavGenerationRule(productCode: string): void {
  mkdirSync(rulesDir(), { recursive: true })
  const empty: CustomFundNavGenerationRule = {
    rule_type: "splice",
    start_date: "",
    funds: DEFAULT_SPLICE_FUNDS.map((row) => ({ ...row })),
    annual_return_rate: "",
    mom_product_name: "",
    mom_fixed_item: "",
    mom_non_fixed_item: "",
    mom_extra_dates: [],
    updated_at: new Date().toISOString(),
  }
  writeFileSync(rulesFile(productCode), JSON.stringify(empty, null, 2))
}

export function assertCustomFundNavRuleAccess(productCode: string, ownerUserId?: string) {
  return assertCustomFundAccess(productCode, ownerUserId)
}
