"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPct, formatRatioPct, formatYuan, type AccountLayerAction, type BreachRow, type CutRow, type HolderRow } from "@/lib/ma/var-mcr-policy"

const API_URL = "/ma/api/mom-analysis/var-mcr-suggestions?volDays=20&corrDays=252"
const POLL_MS = 60_000
const STALE_RETRY_MS = 8_000

type SuggestionPayload = {
  ok: boolean
  date?: string
  latestDate?: string
  selectedDate?: string
  conclusion?: string
  productSoft?: number
  productHard?: number
  sectorSoft?: number
  sectorHard?: number
  varPct?: number | null
  var95?: number | null
  cumCapital?: number | null
  capOk?: boolean
  driver?: { driver: string; dVar: number | null; attrPos: number | null; attrMkt: number | null }
  budgetSoft?: string | null
  budgetHard?: string | null
  budgetHardStreak?: number
  breaches?: BreachRow[]
  approaching?: { products: Array<{ name: string; label: string; sharePct: number }>; sectors: Array<{ name: string; label: string; sharePct: number }> }
  objects?: Array<{
    kind: "product" | "sector"
    name: string
    label: string
    breach: BreachRow
    holders: HolderRow[]
    holderSort: "gross" | "absNet"
    nnrScope: string
    k: number
    kMethod: "bisection" | "linear"
    achievedShare: number | null
    targetPct: number
    formalCut: boolean
    cuts: CutRow[]
    residualCuts: CutRow[]
    cutNote: string
  }>
  accountActions?: AccountLayerAction[]
  dataGaps?: {
    positionsWithoutAdvisor: string[]
    equityWithoutRoster: string[]
    rosterWithoutEquity: string[]
    missingWarningLines: string[]
  }
  cacheStatus?: string
  error?: string
}

function stanceClass(stance: string): string {
  if (stance === "建议减仓") return "bg-red-100 text-red-800 border-red-200"
  if (stance === "禁止新增") return "bg-amber-100 text-amber-800 border-amber-200"
  return "bg-slate-100 text-slate-700 border-slate-200"
}

function actionClass(action: string | null): string {
  if (action === "升级投资经理") return "bg-red-100 text-red-800 border-red-200"
  if (action === "限制该账户新增") return "bg-amber-100 text-amber-800 border-amber-200"
  return "bg-slate-100 text-slate-700 border-slate-200"
}

function holderBarOption(label: string, holders: HolderRow[]) {
  const byAccount = new Map<string, { name: string; gross: number; net: number }>()
  for (const row of holders) {
    const cur = byAccount.get(row.account) ?? { name: row.displayName, gross: 0, net: 0 }
    cur.gross += row.grossMv
    cur.net += row.netMv
    byAccount.set(row.account, cur)
  }
  const rows = [...byAccount.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.gross - a.gross).slice(0, 12)
  if (rows.length === 0) return null
  return {
    title: { text: `${label}账户贡献`, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 600, color: "#1f2937" } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ seriesName: string; value: number; marker: string; name: string }>) => {
        const lines = params.map((p) => `${p.marker}${p.seriesName}: ${formatYuan(Number(p.value))}`)
        return [params[0]?.name, ...lines].join("<br/>")
      },
    },
    legend: { data: ["净市值", "总市值（绝对值合计）"], top: 18, textStyle: { fontSize: 10 } },
    grid: { left: 120, right: 24, top: 42, bottom: 16 },
    xAxis: { type: "value", axisLabel: { fontSize: 9, formatter: (v: number) => `${Math.round(v / 10000)}万` }, splitLine: { lineStyle: { type: "dashed", color: "#E2E8F0" } } },
    yAxis: { type: "category", data: rows.map((r) => r.name).reverse(), axisLabel: { fontSize: 10 } },
    series: [
      { name: "净市值", type: "bar", data: rows.map((r) => r.net).reverse(), itemStyle: { color: "#1A365D" }, barMaxWidth: 14 },
      { name: "总市值（绝对值合计）", type: "bar", data: rows.map((r) => r.gross).reverse(), itemStyle: { color: "#C9A227" }, barMaxWidth: 14 },
    ],
  }
}

export default function VarMcrSuggestionsPanel() {
  const [data, setData] = useState<SuggestionPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const resp = await fetch(API_URL, { cache: "no-cache" })
      const json = (await resp.json()) as SuggestionPayload
      if (!json?.ok) {
        setError(json?.error || "加载失败")
        return
      }
      setError(null)
      setData(json)
      const stale = resp.headers.get("X-Mom-Cache") === "stale" || json.cacheStatus === "stale"
      if (stale) {
        if (staleTimer.current) clearTimeout(staleTimer.current)
        staleTimer.current = setTimeout(() => { void load() }, STALE_RETRY_MS)
      }
    } catch {
      setError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onVis = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVis)
    const poll = setInterval(() => { void load() }, POLL_MS)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      clearInterval(poll)
      if (staleTimer.current) clearTimeout(staleTimer.current)
    }
  }, [load])

  const objects = data?.objects ?? []
  const breaches = data?.breaches ?? []
  const accountActions = data?.accountActions ?? []
  const approaching = data?.approaching

  const gapNotes = useMemo(() => {
    const gaps = data?.dataGaps
    if (!gaps) return []
    const notes: string[] = []
    if (gaps.positionsWithoutAdvisor.length) notes.push(`持仓账户未在投顾对照表中找到姓名：${gaps.positionsWithoutAdvisor.join("、")}。`)
    if (gaps.missingWarningLines.length) notes.push(`下列在场账户对照表中没有解析到预警/止损线：${gaps.missingWarningLines.join("、")}。`)
    if (gaps.equityWithoutRoster.length) notes.push(`有结算权益但不在当前对照表：${gaps.equityWithoutRoster.join("、")}。`)
    return notes
  }, [data])

  if (loading && !data) {
    return (
      <section id="section-intraday-mcr-suggestions" className="mt-4">
        <p className="text-sm text-muted-foreground">处置建议加载中...</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section id="section-intraday-mcr-suggestions" className="mt-4">
        <p className="text-sm text-muted-foreground">{error}</p>
      </section>
    )
  }

  if (!data) {
    return (
      <section id="section-intraday-mcr-suggestions" className="mt-4">
        <p className="text-sm text-muted-foreground">暂无处置建议</p>
      </section>
    )
  }

  return (
    <section id="section-intraday-mcr-suggestions" className="mt-4 space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            当日处置建议
            <span className="text-xs font-normal text-muted-foreground">{data.selectedDate}{data.selectedDate !== data.latestDate ? `（最新日 ${data.latestDate}）` : ""}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
            {data.conclusion}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {data.varPct != null && <span>VaR/资本 {formatPct(data.varPct, 2)}</span>}
            {data.var95 != null && <span>1日95%VaR {formatYuan(data.var95)}</span>}
            {data.cumCapital != null && <span>累计净资本 {formatYuan(data.cumCapital)}</span>}
            {data.driver?.driver && data.driver.driver !== "na" && (
              <span>VaR变化主因：{data.driver.driver === "position" ? "持仓" : data.driver.driver === "market" ? "市场" : "变化很小"}</span>
            )}
          </div>
          {breaches.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium">对象</th>
                    <th className="px-2 py-1.5 text-right font-medium">贡献</th>
                    <th className="px-2 py-1.5 text-right font-medium">软/硬线</th>
                    <th className="px-2 py-1.5 text-right font-medium">软线连续</th>
                    <th className="px-2 py-1.5 text-right font-medium">硬线连续</th>
                    <th className="px-2 py-1.5 text-left font-medium">建议立场</th>
                    <th className="px-2 py-1.5 text-left font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.map((row) => (
                    <tr key={`${row.kind}-${row.name}`} className="border-b last:border-0">
                      <td className="px-2 py-1.5">{row.label}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{formatPct(row.sharePct)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.softPct}% / {row.hardPct}%</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.softStreak} 日</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.hardStreak} 日</td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className={stanceClass(row.stance)}>{row.stance}</Badge>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {row.formalCut ? "正式硬砍" : row.frozenHard ? "硬阈值冻结" : row.nnrAlreadyInEffect ? "禁止新增已生效" : "次日起禁止新增"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              最新日无品种/板块软预警突破。
              {approaching?.products?.length || approaching?.sectors?.length
                ? `接近软线（2 个百分点以内）的有：${[...(approaching?.products ?? []), ...(approaching?.sectors ?? [])].map((row) => `${row.label} ${formatPct(row.sharePct)}`).join("、")}。`
                : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {objects.map((obj) => {
        const option = holderBarOption(obj.label, obj.holders)
        return (
          <Card key={`${obj.kind}-${obj.name}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                {obj.label}：持仓账户与处置
                <Badge variant="outline" className={stanceClass(obj.breach.stance)}>{obj.breach.stance}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <p className="text-xs leading-6 text-foreground">{obj.nnrScope}</p>
              {option && <ReactECharts option={option} style={{ height: Math.max(160, Math.min(320, obj.holders.length * 28 + 80)) }} notMerge lazyUpdate={false} />}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-2 py-1.5 text-left font-medium">账户</th>
                      <th className="px-2 py-1.5 text-left font-medium">品种</th>
                      <th className="px-2 py-1.5 text-right font-medium">净市值</th>
                      <th className="px-2 py-1.5 text-right font-medium">总市值</th>
                      <th className="px-2 py-1.5 text-right font-medium">净手数</th>
                      <th className="px-2 py-1.5 text-right font-medium">占该对象</th>
                      <th className="px-2 py-1.5 text-right font-medium">占该账户</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obj.holders.length === 0 ? (
                      <tr><td colSpan={7} className="px-2 py-2 text-muted-foreground">当日没有查到该对象的账户持仓。</td></tr>
                    ) : obj.holders.map((row) => (
                      <tr key={`${row.account}-${row.prod}`} className="border-b last:border-0">
                        <td className="px-2 py-1.5">{row.displayName}</td>
                        <td className="px-2 py-1.5">{row.prodLabel}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.netMv)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.grossMv)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{row.netLots.toLocaleString("zh-CN")}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatPct(row.shareOfObject * 100)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatPct(row.shareOfAccount * 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                账户排序按{obj.holderSort === "gross" ? "总市值（净市值接近轧平，因此以总暴露为准）" : "净市值绝对值"}。占该对象的分母是上述口径的合计。
              </p>
              <p className="text-xs leading-6">{obj.cutNote}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-2 py-1.5 text-left font-medium">账户</th>
                      <th className="px-2 py-1.5 text-left font-medium">品种</th>
                      <th className="px-2 py-1.5 text-left font-medium">方向</th>
                      <th className="px-2 py-1.5 text-right font-medium">当前市值</th>
                      <th className="px-2 py-1.5 text-right font-medium">目标市值</th>
                      <th className="px-2 py-1.5 text-right font-medium">建议减绝对额</th>
                      <th className="px-2 py-1.5 text-right font-medium">当前手</th>
                      <th className="px-2 py-1.5 text-right font-medium">目标手</th>
                      <th className="px-2 py-1.5 text-right font-medium">建议减/回补手</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obj.cuts.length === 0 ? (
                      <tr><td colSpan={9} className="px-2 py-2 text-muted-foreground">没有需要按比例分摊的主要账户。</td></tr>
                    ) : obj.cuts.map((row) => (
                      <tr key={`${row.account}-${row.prod}`} className="border-b last:border-0">
                        <td className="px-2 py-1.5">{row.displayName}</td>
                        <td className="px-2 py-1.5">{row.prodLabel}</td>
                        <td className="px-2 py-1.5">{row.direction === "short" ? "空头（回补）" : row.direction === "long" ? "多头（减多）" : "平"}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.currentMv)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.targetMv)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.cutAbsMv)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{row.currentLots.toLocaleString("zh-CN")}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{row.targetLots.toLocaleString("zh-CN")}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{row.cutLots.toLocaleString("zh-CN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {obj.residualCuts.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  尾仓未写入减仓指令（占比过小，主要由大户贡献拥挤）：{obj.residualCuts.map((row) => `${row.displayName} ${row.prodLabel} ${formatYuan(row.currentMv)}`).join("；")}。
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                缩放系数 k={obj.k.toFixed(3)}{obj.kMethod === "bisection" ? `，按相关性回算后目标贡献约 ${obj.achievedShare ?? obj.targetPct}%` : "，按贡献占比线性估算"}。
              </p>
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">账户层预警 / 止损</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {accountActions.length === 0 ? (
            <p className="text-xs text-muted-foreground">最新可用结算日，没有账户进入自身预警线上 2 个百分点以内，也没有触及预警或止损。这一层按权益/净入金判断，已把提盈从分母中扣除，不是保证金风险度。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium">账户</th>
                    <th className="px-2 py-1.5 text-right font-medium">权益/净入金</th>
                    <th className="px-2 py-1.5 text-right font-medium">自身预警/止损</th>
                    <th className="px-2 py-1.5 text-left font-medium">建议</th>
                    <th className="px-2 py-1.5 text-left font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {accountActions.map((row) => (
                    <tr key={row.account} className="border-b last:border-0 align-top">
                      <td className="px-2 py-1.5 whitespace-nowrap">{row.displayName}<div className="text-[10px] text-muted-foreground">{row.asOfDate} 权益</div></td>
                      <td className="px-2 py-1.5 text-right font-mono">{formatRatioPct(row.ratio)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.warningStopLoss ?? `${formatRatioPct(row.warnPct, 0)} / ${formatRatioPct(row.stopPct, 0)}`}</td>
                      <td className="px-2 py-1.5"><Badge variant="outline" className={actionClass(row.action)}>{row.action}</Badge></td>
                      <td className="px-2 py-1.5 leading-5">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            口径对齐日间风控 VaR 沙盘与边际贡献时序（vol=20 日，corr=252 日，含当日窗口）。禁止新增针对越线的品种或板块本身，适用于任何会增加该对象绝对暴露的账户，包括新开仓。正式硬砍只在硬线持续不少于 3 个交易日，并且持仓是 VaR 上升主因或 VaR/资本已超过 2.07% 时提出；市场驱动日冻结集中度硬砍。账户层只限制该账户新增或升级投资经理，不把首次触及止损写成自动清仓。风格漂移、持亏加码等旗标不在此自动变成禁开或减仓指令。
          </p>
          {gapNotes.map((note) => (
            <p key={note} className="text-[10px] text-muted-foreground">{note}</p>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
