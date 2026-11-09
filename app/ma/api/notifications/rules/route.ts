import { NextResponse } from "next/server"
import { accountCanUseMom } from "@/lib/ma/account-dashboard"
import {
  MOM_DECISION_SIGNAL_RULE,
  notificationRuleRequiresMom,
  MOM_VAR_BUDGET_RULE,
  parseMomDecisionActions,
  parseMomVarBudget,
  parseMomVarThresholds,
} from "@/lib/system-notifications"
import {
  listNotificationRules,
  setMomDecisionActions,
  setMomVarBudget,
  setMomVarThresholds,
  setNotificationRule,
} from "@/lib/server/system-notifications"
import { getRequestUser } from "@/lib/server/users"

function visibleRules<T extends { key: string }>(rules: T[], user: { role?: string; permissions?: { mom?: boolean } } | null): T[] {
  return rules.filter((rule) => !notificationRuleRequiresMom(rule.key) || accountCanUseMom(user))
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }
  try {
    const rules = visibleRules(await listNotificationRules(user.id), user)
    return NextResponse.json({ rules })
  } catch (error) {
    console.error("[notifications] rules", error)
    return NextResponse.json({ error: "提醒设置加载失败" }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const key = typeof body?.key === "string" ? body.key : ""
  if (!key || (typeof body?.enabled !== "boolean" && body?.config == null)) {
    return NextResponse.json({ error: "请指定要打开或关闭的提醒" }, { status: 400 })
  }
  if (notificationRuleRequiresMom(key) && !accountCanUseMom(user)) {
    return NextResponse.json({ error: "这个提醒只对能看 MOM 的账户开放" }, { status: 403 })
  }
  try {
    if (body?.config != null) {
      if (key === MOM_VAR_BUDGET_RULE) {
        const budget = parseMomVarBudget(body.config)
        if (!budget) {
          return NextResponse.json({ error: "年化风险预算需要是 0 到 100 之间的数字" }, { status: 400 })
        }
        return NextResponse.json({ rules: visibleRules(await setMomVarBudget(user.id, budget.annualPct), user) })
      }
      if (key === MOM_DECISION_SIGNAL_RULE) {
        const actions = parseMomDecisionActions(body.config)
        if (!actions) {
          return NextResponse.json({ error: "请至少选择一种建议" }, { status: 400 })
        }
        return NextResponse.json({ rules: visibleRules(await setMomDecisionActions(user.id, actions), user) })
      }
      const thresholds = parseMomVarThresholds(body.config)
      if (!thresholds) {
        return NextResponse.json({ error: "阈值需要是 0 到 100 之间的数字" }, { status: 400 })
      }
      return NextResponse.json({ rules: visibleRules(await setMomVarThresholds(user.id, thresholds), user) })
    }
    return NextResponse.json({ rules: visibleRules(await setNotificationRule(user.id, key, body.enabled), user) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败"
    const status = message === "未知提醒" ? 400 : 500
    if (status === 500) console.error("[notifications] rule", error)
    return NextResponse.json({ error: message }, { status })
  }
}
