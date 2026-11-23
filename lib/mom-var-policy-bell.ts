/**
 * Bell copy for the MOM VaR report.
 * The sentences come from the same MOM-lite classifier as 处置建议:
 * soft lines forbid adding exposure, a formal cut needs the hard line for
 * three sessions plus a position or budget condition, and a market-driven
 * day freezes that cut. The budget gate is separate: 2.07% is a warning,
 * 5% for three sessions scales the whole book.
 */

import {
  buildConclusion,
  type BreachRow,
  type DriverKind,
} from "@/lib/ma/var-mcr-policy"

const HREF = "/ma/dashboard/mom-analysis/risk-report?tab=intraday#section-intraday-mcr-suggestions"

export type MomVarBell = { title: string; body: string; href: string }

export function momVarConcentrationBell(input: {
  date: string
  breaches: readonly BreachRow[]
  driver: DriverKind
}): MomVarBell | null {
  if (input.breaches.length === 0) return null
  const formal = input.breaches.some((row) => row.formalCut)
  const frozen = input.breaches.some((row) => row.frozenHard)
  const action = formal ? "建议减仓" : frozen ? "硬阈值冻结" : "禁止新增"
  return {
    title: `${input.date} 日间风控${action}`,
    body: buildConclusion({
      date: input.date,
      breaches: input.breaches,
      varPct: null,
      capOk: false,
      driver: input.driver,
    }),
    href: HREF,
  }
}

export function momVarBudgetBell(input: {
  date: string
  budgetSoft: string | null
  budgetHard: string | null
}): MomVarBell | null {
  if (!input.budgetSoft && !input.budgetHard) return null
  return {
    title: input.budgetHard ? `${input.date} 日间风控预算硬闸门` : `${input.date} 日间风控预算软预警`,
    body: [input.budgetSoft, input.budgetHard].filter(Boolean).join(""),
    href: HREF,
  }
}
