"use client"

import { useCallback, useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { authService } from "@/lib/auth"
import { MOM_DECISION_ACTIONS, MOM_DECISION_SIGNAL_RULE, MOM_VAR_BUDGET_RULE, MOM_VAR_CONCENTRATION_RULE } from "@/lib/system-notifications"
import { dailyVarBudgetPct } from "@/lib/mom-var-budget"

type NotificationRule = {
  key: string
  kind: "periodic" | "abnormal" | "launch"
  title: string
  description: string
  enabled: boolean
  config?: { productPct?: number; sectorPct?: number; actions?: string[]; annualPct?: number }
}

const GROUPS: Array<{ kind: NotificationRule["kind"]; title: string; empty: string }> = [
  { kind: "periodic", title: "定期", empty: "还没有定期提醒。" },
  { kind: "launch", title: "上线", empty: "新功能上线提醒还没有打开。" },
  { kind: "abnormal", title: "异常", empty: "异常提醒还没有项目。之后可以在这里打开，例如数据中断或净值异常。" },
]

export function NotificationSettingsPanel() {
  const [userId, setUserId] = useState("")
  const [rules, setRules] = useState<NotificationRule[] | null>(null)
  const [error, setError] = useState("")
  const [savingKey, setSavingKey] = useState("")
  const [productPct, setProductPct] = useState("30")
  const [sectorPct, setSectorPct] = useState("50")
  const [actions, setActions] = useState<string[]>(["加码"])
  const [annualPct, setAnnualPct] = useState("20")

  const loadRules = useCallback(async (id: string) => {
    const res = await fetch("/ma/api/notifications/rules", {
      cache: "no-store",
      headers: { "x-market-user-id": id },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "提醒设置加载失败")
    const next = Array.isArray(json.rules) ? json.rules as NotificationRule[] : []
    setRules(next)
    applySavedConfig(next)
    setError("")
  }, [])

  useEffect(() => {
    const id = authService.getCurrentUser()?.id ?? ""
    setUserId(id)
    if (!id) {
      setError("请先登录")
      return
    }
    loadRules(id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "提醒设置加载失败")
    })
  }, [loadRules])

  async function toggleRule(rule: NotificationRule, enabled: boolean) {
    if (!userId) return
    setSavingKey(rule.key)
    setError("")
    setRules((prev) => prev?.map((item) => item.key === rule.key ? { ...item, enabled } : item) ?? prev)
    try {
      const res = await fetch("/ma/api/notifications/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-market-user-id": userId },
        body: JSON.stringify({ key: rule.key, enabled }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "保存失败")
      setRules(Array.isArray(json.rules) ? json.rules : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
      loadRules(userId).catch(() => {})
    } finally {
      setSavingKey("")
    }
  }

  function applySavedConfig(next: NotificationRule[]) {
    const concentration = next.find((rule) => rule.key === MOM_VAR_CONCENTRATION_RULE)
    if (concentration?.config?.productPct != null && concentration.config.sectorPct != null) {
      setProductPct(String(concentration.config.productPct))
      setSectorPct(String(concentration.config.sectorPct))
    }
    const decision = next.find((rule) => rule.key === MOM_DECISION_SIGNAL_RULE)
    if (decision?.config?.actions?.length) setActions(decision.config.actions)
    const budget = next.find((rule) => rule.key === MOM_VAR_BUDGET_RULE)
    if (budget?.config?.annualPct != null) setAnnualPct(String(budget.config.annualPct))
  }

  async function saveActions(nextActions: string[]) {
    if (!userId) return
    setSavingKey(MOM_DECISION_SIGNAL_RULE)
    setError("")
    try {
      const res = await fetch("/ma/api/notifications/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-market-user-id": userId },
        body: JSON.stringify({ key: MOM_DECISION_SIGNAL_RULE, config: { actions: nextActions } }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "保存失败")
      const next = Array.isArray(json.rules) ? json.rules as NotificationRule[] : []
      setRules(next)
      applySavedConfig(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
      loadRules(userId).catch(() => {})
    } finally {
      setSavingKey("")
    }
  }

  function toggleAction(action: string, checked: boolean) {
    const next = checked ? [...actions, action] : actions.filter((item) => item !== action)
    if (next.length === 0) {
      setError("请至少选择一种建议")
      return
    }
    setActions(next)
    void saveActions(next)
  }

  async function saveAnnual() {
    if (!userId) return
    const annual = Number(annualPct)
    if (!(annual > 0 && annual <= 100)) {
      setError("年化风险预算需要是 0 到 100 之间的数字")
      return
    }
    const current = rules?.find((rule) => rule.key === MOM_VAR_BUDGET_RULE)?.config?.annualPct ?? 20
    if (current === annual) return
    setSavingKey(MOM_VAR_BUDGET_RULE)
    setError("")
    try {
      const res = await fetch("/ma/api/notifications/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-market-user-id": userId },
        body: JSON.stringify({ key: MOM_VAR_BUDGET_RULE, config: { annualPct: annual } }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "保存失败")
      const next = Array.isArray(json.rules) ? json.rules as NotificationRule[] : []
      setRules(next)
      applySavedConfig(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
      loadRules(userId).catch(() => {})
    } finally {
      setSavingKey("")
    }
  }

  async function saveThresholds() {
    if (!userId) return
    const product = Number(productPct)
    const sector = Number(sectorPct)
    if (!(product > 0 && product <= 100 && sector > 0 && sector <= 100)) {
      setError("阈值需要是 0 到 100 之间的数字")
      return
    }
    const current = rules?.find((rule) => rule.key === MOM_VAR_CONCENTRATION_RULE)?.config
      ?? { productPct: 30, sectorPct: 50 }
    if (current.productPct === product && current.sectorPct === sector) return
    setSavingKey(MOM_VAR_CONCENTRATION_RULE)
    setError("")
    try {
      const res = await fetch("/ma/api/notifications/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-market-user-id": userId },
        body: JSON.stringify({ key: MOM_VAR_CONCENTRATION_RULE, config: { productPct: product, sectorPct: sector } }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "保存失败")
      setRules(Array.isArray(json.rules) ? json.rules : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
      loadRules(userId).catch(() => {})
    } finally {
      setSavingKey("")
    }
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">提醒设置</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        选择本账户要接收的提醒。默认打开周度策略对比 Excel、在管产品系统周报、美国 CPI 和非农，以及新功能上线。
      </p>
      {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
      <div className="mt-6 space-y-8">
        {GROUPS.map((group) => {
          const items = (rules ?? []).filter((rule) => rule.kind === group.kind)
          return (
            <section key={group.kind}>
              <h3 className="text-sm font-medium text-zinc-500">{group.title}</h3>
              {items.length === 0 ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{rules ? group.empty : "加载中…"}</p>
              ) : (
                <ul className="mt-3 divide-y rounded-lg border">
                  {items.map((rule) => (
                    <li key={rule.key} className="px-4 py-4">
                      <div className="flex items-start justify-between gap-6">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{rule.title}</div>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{rule.description}</p>
                        </div>
                        <Switch
                          className="mt-0.5"
                          checked={rule.enabled}
                          disabled={savingKey === rule.key}
                          onCheckedChange={(checked) => { void toggleRule(rule, checked) }}
                          aria-label={rule.title}
                        />
                      </div>
                      {rule.key === MOM_DECISION_SIGNAL_RULE && (
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                          {MOM_DECISION_ACTIONS.map((action) => (
                            <label key={action} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={actions.includes(action)}
                                disabled={savingKey === rule.key}
                                aria-label={`建议 ${action}`}
                                onChange={(event) => toggleAction(action, event.target.checked)}
                              />
                              {action}
                            </label>
                          ))}
                        </div>
                      )}
                      {rule.key === MOM_VAR_BUDGET_RULE && (
                        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                          年化风险预算
                          <input
                            value={annualPct}
                            inputMode="decimal"
                            aria-label="年化风险预算"
                            onChange={(event) => setAnnualPct(event.target.value)}
                            onBlur={() => { void saveAnnual() }}
                            className="h-8 w-20 rounded-md border bg-background px-2"
                          />
                          %
                          <span className="text-muted-foreground">
                            1 日 95% 上限 {Number(annualPct) > 0 && Number(annualPct) <= 100 ? dailyVarBudgetPct(Number(annualPct)).toFixed(2) : "—"}%
                          </span>
                        </label>
                      )}
                      {rule.key === MOM_VAR_CONCENTRATION_RULE && (
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                          <label className="flex items-center gap-2">
                            品种超过
                            <input
                              value={productPct}
                              inputMode="decimal"
                              aria-label="品种边际波动贡献阈值"
                              onChange={(event) => setProductPct(event.target.value)}
                              onBlur={() => { void saveThresholds() }}
                              className="h-8 w-20 rounded-md border bg-background px-2"
                            />
                            %
                          </label>
                          <label className="flex items-center gap-2">
                            板块超过
                            <input
                              value={sectorPct}
                              inputMode="decimal"
                              aria-label="板块边际波动贡献阈值"
                              onChange={(event) => setSectorPct(event.target.value)}
                              onBlur={() => { void saveThresholds() }}
                              className="h-8 w-20 rounded-md border bg-background px-2"
                            />
                            %
                          </label>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
