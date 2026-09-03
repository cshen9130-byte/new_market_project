import { normalizeSpliceFunds } from "@/lib/custom-fund-nav-rules-types"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import { generateCustomFundNavFromRule } from "@/lib/server/custom-fund-nav-generate"
import { getCustomFundNavGenerationRule } from "@/lib/server/custom-fund-nav-rules"
import { getCustomFundLatestNav } from "@/lib/server/custom-fund-nav"
import { listAllCustomFundRecords, type CustomFundRecord } from "@/lib/server/custom-funds"

export type CustomFundNavRefreshItem = {
  product_code: string
  product_name: string
  status: "refreshed" | "skipped" | "failed"
  count?: number
  latest_nav_date?: string | null
  error?: string
}

export type CustomFundNavRefreshResult = {
  ok: boolean
  refreshed: number
  skipped: number
  failed: number
  items: CustomFundNavRefreshItem[]
}

let refreshChain: Promise<unknown> = Promise.resolve()

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = refreshChain.then(fn, fn)
  refreshChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function isRunnableRule(
  rule: ReturnType<typeof getCustomFundNavGenerationRule>,
): rule is NonNullable<ReturnType<typeof getCustomFundNavGenerationRule>> {
  if (!rule) return false
  if (rule.rule_type === "fixed_income") {
    return Boolean(rule.start_date.trim() && Number.isFinite(parseFloat(rule.annual_return_rate)))
  }
  if (rule.rule_type !== "splice") return false
  const active = normalizeSpliceFunds(rule.funds, rule.start_date).filter((f) => f.product_name)
  return active.length >= 2 && Boolean(active[0].start_date || rule.start_date)
}

async function refreshOneFund(fund: CustomFundRecord): Promise<CustomFundNavRefreshItem> {
  const rule = getCustomFundNavGenerationRule(fund.product_code)
  if (!isRunnableRule(rule)) {
    return {
      product_code: fund.product_code,
      product_name: fund.product_name,
      status: "skipped",
      error: "无可用生成规则",
    }
  }

  const normalized = {
    ...rule,
    funds: normalizeSpliceFunds(rule.funds, rule.start_date),
  }
  const generated = await generateCustomFundNavFromRule(fund.product_code, normalized)
  if (!generated.ok) {
    return {
      product_code: fund.product_code,
      product_name: fund.product_name,
      status: "failed",
      error: generated.error,
    }
  }

  const latest = getCustomFundLatestNav(fund.product_code)
  return {
    product_code: fund.product_code,
    product_name: fund.product_name,
    status: "refreshed",
    count: generated.count,
    latest_nav_date: latest?.latest_nav_date ?? null,
  }
}

/** Rebuild every 自建基金 that has a splice / fixed-income rule. */
export async function refreshAllCustomFundNavFromRules(): Promise<CustomFundNavRefreshResult> {
  return withRefreshLock(async () => {
    const items: CustomFundNavRefreshItem[] = []
    for (const fund of listAllCustomFundRecords()) {
      items.push(await refreshOneFund(fund))
    }
    const refreshed = items.filter((row) => row.status === "refreshed").length
    const skipped = items.filter((row) => row.status === "skipped").length
    const failed = items.filter((row) => row.status === "failed").length
    return {
      ok: failed === 0,
      refreshed,
      skipped,
      failed,
      items,
    }
  })
}

/**
 * Rebuild one fund when its stored snapshot is older than yesterday (Shanghai).
 * Used by the detail page so a stale file does not wait for the next cron.
 */
export async function ensureCustomFundNavFresh(productCode: string): Promise<void> {
  const code = productCode.trim()
  if (!code) return
  const fund = listAllCustomFundRecords().find((row) => row.product_code === code)
  if (!fund) return
  if (!isRunnableRule(getCustomFundNavGenerationRule(code))) return

  const latest = getCustomFundLatestNav(code)?.latest_nav_date ?? ""
  const today = shanghaiTodayIsoDate()
  const yesterday = new Date(`${today}T00:00:00+08:00`)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayIso = shanghaiTodayIsoDate(yesterday)
  if (latest && latest >= yesterdayIso) return

  await withRefreshLock(() => refreshOneFund(fund))
}
