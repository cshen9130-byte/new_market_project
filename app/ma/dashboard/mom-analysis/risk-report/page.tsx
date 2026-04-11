"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { BarChart2, ShieldAlert, PieChart, Users } from "lucide-react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const ProductNavChart = dynamic(() => import("@/components/ma/product-nav-chart"), { ssr: false })

const subNavItems = [
  { key: "overview",  name: "产品总览", icon: BarChart2 },
  { key: "intraday",  name: "日间风控", icon: ShieldAlert },
  { key: "position",  name: "持仓分析", icon: PieChart },
  { key: "advisor",   name: "投顾分析", icon: Users },
] as const

type TabKey = (typeof subNavItems)[number]["key"]

function PlaceholderContent({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm">页面建设中，敬请期待。</p>
    </div>
  )
}

function OverviewContent() {
  return (
    <div className="space-y-4">
      <div className="w-full">
        <ProductNavChart height={380} />
      </div>
    </div>
  )
}

const PROD_CAT: Record<string, string> = {
  C:"商品",CS:"商品",WH:"商品",PM:"商品",RR:"商品",RI:"商品",JR:"商品",LR:"商品",
  A:"商品",B:"商品",M:"商品",Y:"商品",RM:"商品",OI:"商品",RS:"商品",PK:"商品",P:"商品",
  SR:"商品",CF:"商品",CY:"商品",LG:"商品",SP:"商品",OP:"商品",
  AP:"商品",CJ:"商品",LH:"商品",JD:"商品",
  AU:"商品",AG:"商品",PT:"商品",PD:"商品",
  CU:"商品",BC:"商品",AL:"商品",AO:"商品",AD:"商品",ZN:"商品",PB:"商品",NI:"商品",SN:"商品",
  LC:"商品",PS:"商品",SI:"商品",
  I:"商品",SF:"商品",SM:"商品",RB:"商品",HC:"商品",SS:"商品",WR:"商品",
  JM:"商品",J:"商品",ZC:"商品",FG:"商品",BB:"商品",FB:"商品",
  SC:"商品",FU:"商品",LU:"商品",PG:"商品",BU:"商品",
  TA:"商品",EG:"商品",PF:"商品",PR:"商品",PL:"商品",PP:"商品",L:"商品",
  BZ:"商品",PX:"商品",EB:"商品",
  RU:"商品",BR:"商品",NR:"商品",
  SA:"商品",SH:"商品",V:"商品",UR:"商品",MA:"商品",
  EC:"商品",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}
const PROD_SECTOR: Record<string, string> = {
  C:"农产",CS:"农产",WH:"农产",PM:"农产",RR:"农产",RI:"农产",JR:"农产",LR:"农产",
  A:"农产",B:"农产",M:"农产",Y:"农产",RM:"农产",OI:"农产",RS:"农产",PK:"农产",P:"农产",
  SR:"农产",CF:"农产",CY:"农产",LG:"农产",SP:"农产",OP:"农产",
  AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
  AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
  CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
  LC:"新能源",PS:"新能源",SI:"新能源",
  I:"黑色",SF:"黑色",SM:"黑色",RB:"黑色",HC:"黑色",SS:"黑色",WR:"黑色",
  JM:"黑色",J:"黑色",ZC:"黑色",FG:"黑色",BB:"黑色",FB:"黑色",
  SC:"能源化工",FU:"能源化工",LU:"能源化工",PG:"能源化工",BU:"能源化工",
  TA:"能源化工",EG:"能源化工",PF:"能源化工",PR:"能源化工",PL:"能源化工",PP:"能源化工",L:"能源化工",
  BZ:"能源化工",PX:"能源化工",EB:"能源化工",
  RU:"能源化工",BR:"能源化工",NR:"能源化工",
  SA:"能源化工",SH:"能源化工",V:"能源化工",UR:"能源化工",MA:"能源化工",
  EC:"航运",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}
const PROD_SUB_SECTOR: Record<string, string> = {
  C:"谷物",CS:"谷物",WH:"谷物",PM:"谷物",RR:"谷物",RI:"谷物",JR:"谷物",LR:"谷物",
  A:"油脂油料",B:"油脂油料",M:"油脂油料",Y:"油脂油料",RM:"油脂油料",OI:"油脂油料",RS:"油脂油料",PK:"油脂油料",P:"油脂油料",
  SR:"软商品",CF:"软商品",CY:"软商品",
  LG:"林业",SP:"林业",OP:"林业",
  AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
  AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
  CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
  LC:"新能源",PS:"新能源",SI:"新能源",
  I:"原材",SF:"原材",SM:"原材",
  RB:"成材",HC:"成材",SS:"成材",WR:"成材",
  JM:"煤炭",J:"煤炭",ZC:"煤炭",
  FG:"建材",BB:"建材",FB:"建材",
  SC:"油品",FU:"油品",LU:"油品",PG:"油品",BU:"油品",
  TA:"聚酯",EG:"聚酯",PF:"聚酯",PR:"聚酯",
  PL:"烯烃",PP:"烯烃",L:"烯烃",
  BZ:"芳烃",PX:"芳烃",EB:"芳烃",
  RU:"橡胶",BR:"橡胶",NR:"橡胶",
  SA:"盐化工",SH:"盐化工",V:"盐化工",
  UR:"煤化工",MA:"煤化工",
  EC:"航运",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}
const PROD_NAMES: Record<string, string> = {
  C:"玉米",CS:"淀粉",WH:"强麦",PM:"普麦",RR:"粳米",RI:"早籼稻",JR:"粳稻",LR:"晚籼稻",
  A:"黄大豆1号",B:"黄大豆2号",M:"豆粕",Y:"豆油",RM:"菜籽粕",OI:"菜籽油",RS:"油菜籽",PK:"花生",P:"棕榈油",
  SR:"白糖",CF:"棉花",CY:"棉纱",LG:"原木",SP:"纸浆",OP:"双胶纸",
  AP:"苹果",CJ:"红枣",LH:"生猪",JD:"鸡蛋",
  AU:"黄金",AG:"白银",PT:"铂",PD:"钯",
  CU:"沪铜",BC:"国际铜",AL:"沪铝",AO:"氧化铝",AD:"铝合金",ZN:"沪锌",PB:"沪铅",NI:"沪镍",SN:"沪锡",
  LC:"碳酸锂",PS:"多晶硅",SI:"工业硅",
  I:"铁矿石",SF:"硅铁",SM:"锰硅",RB:"螺纹钢",HC:"热卷",SS:"不锈钢",WR:"线材",
  JM:"焦煤",J:"煤炭",ZC:"动力煤",FG:"玻璃",BB:"胶合板",FB:"纤维板",
  SC:"原油",FU:"燃料油",LU:"低硫燃料油",PG:"液化石油气",BU:"沥青",
  TA:"PTA",EG:"乙二醇",PF:"短纤",PR:"瓶片",PL:"丙烯",PP:"聚丙烯",L:"塑料",
  BZ:"纯苯",PX:"对二甲苯",EB:"苯乙烯",
  RU:"天然橡胶",BR:"丁二烯橡胶",NR:"20号胶",
  SA:"纯碱",SH:"烧碱",V:"PVC",UR:"尿素",MA:"甲醇",
  EC:"航运指数",
  IH:"上证50",IF:"沪深300",IC:"中证500",IM:"中证1000",MO:"中证1000期权",
  TS:"2年期国债",TF:"5年期国债",T:"10年期国债",TL:"30年期国债",
}

function IntradayContent() {
  const [pnlData, setPnlData] = useState<{ date: string; pnl: number }[]>([])
  const [sectorLatest, setSectorLatest] = useState<{ sector: string; pnl: number }[]>([])
  const [prodLatest, setProdLatest] = useState<{ key: string; pnl: number }[]>([])
  const [accountLatest, setAccountLatest] = useState<{ account: string; pnl: number }[]>([])
  const [sectorView, setSectorView] = useState<"total" | "ls">("total")
  const [sectorLS, setSectorLS] = useState<{ sector: string; long: number; short: number }[]>([])
  const [prodView, setProdView] = useState<"total" | "ls">("total")
  const [prodLS, setProdLS] = useState<{ prod: string; long: number; short: number }[]>([])
  const [varData, setVarData] = useState<{ date: string; var: number; actual: number }[]>([])
  const [varBreachRate, setVarBreachRate] = useState<number | null>(null)
  const [varLoading, setVarLoading] = useState(false)
  const [varConfidence, setVarConfidence] = useState("95")
  const [varVolDays, setVarVolDays] = useState("20")
  const [varCorrDays, setVarCorrDays] = useState("252")
  const [varDistModel, setVarDistModel] = useState("normal")
  const [varZoom, setVarZoom] = useState<{ start: number; end: number }>({ start: 60, end: 100 })
  const [varFitView, setVarFitView] = useState<"chart" | "table">("chart")
  type OptResult = {
    confidence: string; volDays: number; corrDays: number; distModel: string
    N: number; breaches: number; breachRate: number; expectedRate: number
    kupiecLR: number; ccLR: number; kupiecPass: boolean; ccPass: boolean
    mae: number; rmse: number; avgVar: number; coverageRatio: number; score: number
  }
  const [varOptResults, setVarOptResults] = useState<OptResult[]>([])
  const [varOptLoading, setVarOptLoading] = useState(false)
  const [varOptOpen, setVarOptOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [prodCatFilter, setProdCatFilter] = useState("全部")
  const [prodSectorFilter, setProdSectorFilter] = useState("全部")
  const [prodSubSectorFilter, setProdSubSectorFilter] = useState("全部")

  const fetchVar = (confidence: string, volDays: string, corrDays: string, distModel: string) => {
    setVarLoading(true)
    const params = new URLSearchParams({ confidence, volDays, corrDays, distModel })
    fetch(`/ma/api/mom-analysis/var-prediction?${params}`)
      .then((r) => r.json())
      .then((varJson) => {
        setVarData(varJson.data ?? [])
        if (varJson.breachRate != null) setVarBreachRate(varJson.breachRate)
      })
      .catch(() => {})
      .finally(() => setVarLoading(false))
  }

  useEffect(() => {
    Promise.all([
      fetch("/ma/api/mom-analysis/product-nav").then((r) => r.json()),
      fetch("/ma/api/mom-analysis/category-pnl").then((r) => r.json()),
      fetch("/ma/api/mom-analysis/account-daily-pnl").then((r) => r.json()),
      fetch("/ma/api/mom-analysis/sector-ls-pnl").then((r) => r.json()),
      fetch(`/ma/api/mom-analysis/var-prediction?confidence=${varConfidence}&volDays=${varVolDays}&corrDays=${varCorrDays}&distModel=${varDistModel}`).then((r) => r.json()),
    ]).then(([navJson, catJson, acctJson, lsJson, varJson]) => {
      const rows: { date: string; pnl: number }[] = (navJson.data ?? []).map(
        (r: { date: string; pnl: number }) => ({ date: r.date, pnl: r.pnl })
      )
      setPnlData(rows)

      const sectorData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = catJson.sectorData ?? {}
      const latest = Object.entries(sectorData)
        .map(([sector, rows]) => ({ sector, pnl: rows.length > 0 ? rows[rows.length - 1].pnl : 0 }))
        .filter((s) => s.pnl !== 0)
        .sort((a, b) => b.pnl - a.pnl)
      setSectorLatest(latest)

      const productData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = catJson.productData ?? {}
      const prodList = Object.entries(productData)
        .map(([key, rows]) => ({ key, pnl: rows.length > 0 ? rows[rows.length - 1].pnl : 0 }))
        .filter((p) => p.pnl !== 0)
        .sort((a, b) => b.pnl - a.pnl)
      setProdLatest(prodList)

      const accountData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = acctJson.accountData ?? {}
      const acctList = Object.entries(accountData)
        .map(([account, rows]) => ({ account, pnl: rows.length > 0 ? rows[rows.length - 1].pnl : 0 }))
        .filter((a) => a.pnl !== 0)
        .sort((a, b) => b.pnl - a.pnl)
      setAccountLatest(acctList)

      const rawLS: { sector: string; long: number; short: number }[] = lsJson.sectorLS ?? []
      setSectorLS([...rawLS].sort((a, b) => (b.long + b.short) - (a.long + a.short)))

      const rawProdLS: { prod: string; long: number; short: number }[] = lsJson.productLS ?? []
      setProdLS([...rawProdLS].sort((a, b) => (b.long + b.short) - (a.long + a.short)))

      setVarData(varJson.data ?? [])
      if (varJson.breachRate != null) setVarBreachRate(varJson.breachRate)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const barOption = {
    tooltip: {
      trigger: "axis",
      formatter: (params: { name: string; value: number; marker: string }[]) =>
        params.map((p) => `${p.marker}${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
    },
    grid: { left: 60, right: 20, top: 20, bottom: 50 },
    xAxis: {
      type: "category",
      data: pnlData.map((r) => r.date),
      axisLabel: { fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
    },
    dataZoom: [
      { type: "inside", start: 80, end: 100 },
      { type: "slider", height: 20, bottom: 5 },
    ],
    series: [
      {
        type: "bar",
        data: pnlData.map((r) => ({
          value: r.pnl,
          itemStyle: { color: r.pnl >= 0 ? "#ef4444" : "#22c55e" },
        })),
      },
    ],
  }

  const sectorBarOption = {
    tooltip: {
      trigger: "axis",
      formatter: (params: { name: string; value: number; marker: string }[]) =>
        params.map((p) => `${p.marker}${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
    },
    grid: { left: 70, right: 20, top: 20, bottom: 60 },
    xAxis: {
      type: "category",
      data: sectorLatest.map((s) => s.sector),
      axisLabel: { fontSize: 11, rotate: 30 },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
    },
    series: [
      {
        type: "bar",
        data: sectorLatest.map((s) => ({
          value: s.pnl,
          itemStyle: { color: s.pnl >= 0 ? "#ef4444" : "#22c55e" },
        })),
        label: {
          show: true,
          position: "top",
          formatter: (p: { value: number }) => (p.value / 10000).toFixed(1) + "万",
          fontSize: 10,
        },
      },
    ],
  }

  const availableSectors = ["全部", ...Array.from(new Set(
    Object.entries(PROD_SECTOR)
      .filter(([k]) => prodCatFilter === "全部" || PROD_CAT[k] === prodCatFilter)
      .map(([, v]) => v)
  ))]
  const availableSubSectors = ["全部", ...Array.from(new Set(
    Object.entries(PROD_SUB_SECTOR)
      .filter(([k]) => prodCatFilter === "全部" || PROD_CAT[k] === prodCatFilter)
      .filter(([k]) => prodSectorFilter === "全部" || PROD_SECTOR[k] === prodSectorFilter)
      .map(([, v]) => v)
  ))]
  const filteredProdLatest = prodLatest
    .filter((p) => prodCatFilter === "全部" || PROD_CAT[p.key] === prodCatFilter)
    .filter((p) => prodSectorFilter === "全部" || PROD_SECTOR[p.key] === prodSectorFilter)
    .filter((p) => prodSubSectorFilter === "全部" || PROD_SUB_SECTOR[p.key] === prodSubSectorFilter)
  const filteredProdLS = prodLS
    .filter((p) => prodCatFilter === "全部" || PROD_CAT[p.prod] === prodCatFilter)
    .filter((p) => prodSectorFilter === "全部" || PROD_SECTOR[p.prod] === prodSectorFilter)
    .filter((p) => prodSubSectorFilter === "全部" || PROD_SUB_SECTOR[p.prod] === prodSubSectorFilter)
    .sort((a, b) => (b.long + b.short) - (a.long + a.short))

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          当日盈亏
          <span className="h-px flex-1 bg-border" />
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">加载中...</p>
        ) : (
          <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">组合每日盈亏</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ReactECharts option={barOption} style={{ height: 300 }} notMerge />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">板块当日盈亏</CardTitle>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSectorView("total")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${sectorView === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      合计
                    </button>
                    <button
                      onClick={() => setSectorView("ls")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${sectorView === "ls" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      多空
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                {sectorView === "total" ? (
                  <ReactECharts option={sectorBarOption} style={{ height: 300 }} notMerge />
                ) : (
                  <ReactECharts
                    option={{
                      tooltip: {
                        trigger: "axis",
                        formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
                          const valid = params.filter((p) => p.seriesName === "多头" || p.seriesName === "空头")
                          const lines = valid.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
                          const net = valid.reduce((s, p) => s + Number(p.value), 0)
                          lines.push(`合计: ${net.toLocaleString("zh-CN")} 元`)
                          return [params[0]?.name, ...lines].join("<br/>")
                        },
                      },
                      legend: { data: ["多头", "空头"], top: 5, itemWidth: 12, itemGap: 8 },
                      grid: { left: 70, right: 20, top: 35, bottom: 60 },
                      xAxis: {
                        type: "category",
                        data: sectorLS.map((s) => s.sector),
                        axisLabel: { fontSize: 11, rotate: 30 },
                      },
                      yAxis: {
                        type: "value",
                        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
                      },
                      series: [
                        {
                          name: "多头",
                          type: "bar",
                          stack: "ls",
                          data: sectorLS.map((s) => ({
                            value: s.long,
                            itemStyle: { color: s.long >= 0 ? "#ef4444" : "#22c55e" },
                          })),
                        },
                        {
                          name: "空头",
                          type: "bar",
                          stack: "ls",
                          data: sectorLS.map((s) => ({
                            value: s.short,
                            itemStyle: { color: s.short >= 0 ? "#ef444488" : "#22c55e88" },
                          })),
                        },
                      ],
                    }}
                    style={{ height: 300 }}
                    notMerge
                  />
                )}
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Card>
              <CardHeader className="pb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-sm">品种当日盈亏</CardTitle>
                  <div className="flex gap-1 ml-auto">
                    <button
                      onClick={() => setProdView("total")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${prodView === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >合计</button>
                    <button
                      onClick={() => setProdView("ls")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${prodView === "ls" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >多空</button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <select
                    className="text-xs border rounded px-1 py-0.5 bg-background"
                    value={prodCatFilter}
                    onChange={(e) => { setProdCatFilter(e.target.value); setProdSectorFilter("全部"); setProdSubSectorFilter("全部") }}
                  >
                    <option value="全部">大类资产</option>
                    {["商品","股指","国债"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select
                    className="text-xs border rounded px-1 py-0.5 bg-background"
                    value={prodSectorFilter}
                    onChange={(e) => { setProdSectorFilter(e.target.value); setProdSubSectorFilter("全部") }}
                  >
                    {availableSectors.map((s) => <option key={s} value={s}>{s === "全部" ? "板块" : s}</option>)}
                  </select>
                  <select
                    className="text-xs border rounded px-1 py-0.5 bg-background"
                    value={prodSubSectorFilter}
                    onChange={(e) => setProdSubSectorFilter(e.target.value)}
                  >
                    {availableSubSectors.map((ss) => <option key={ss} value={ss}>{ss === "全部" ? "细分板块" : ss}</option>)}
                  </select>
                  {(prodCatFilter !== "全部" || prodSectorFilter !== "全部" || prodSubSectorFilter !== "全部") && (
                    <button
                      onClick={() => { setProdCatFilter("全部"); setProdSectorFilter("全部"); setProdSubSectorFilter("全部") }}
                      className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >重置</button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                {prodView === "total" ? (
                  <ReactECharts
                    option={{
                      tooltip: {
                        trigger: "axis",
                        formatter: (params: { name: string; value: number; marker: string }[]) =>
                          params.map((p) => {
                            const cn = PROD_NAMES[p.name]
                            const label = cn ? `${p.name}（${cn}）` : p.name
                            return `${p.marker}${label}: ${Number(p.value).toLocaleString("zh-CN")} 元`
                          }).join("<br/>"),
                      },
                      grid: { left: 55, right: 10, top: 15, bottom: 50 },
                      xAxis: {
                        type: "category",
                        data: filteredProdLatest.map((p) => p.key),
                        axisLabel: { fontSize: 10, rotate: 45 },
                      },
                      yAxis: {
                        type: "value",
                        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
                      },
                      series: [{
                        type: "bar",
                        data: filteredProdLatest.map((p) => ({
                          value: p.pnl,
                          itemStyle: { color: p.pnl >= 0 ? "#ef4444" : "#22c55e" },
                        })),
                        label: { show: false },
                      }],
                    }}
                    style={{ height: 240 }}
                    notMerge
                  />
                ) : (
                  <ReactECharts
                    option={{
                      tooltip: {
                        trigger: "axis",
                        formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
                          const valid = params.filter((p) => p.seriesName === "多头" || p.seriesName === "空头")
                          const cn = PROD_NAMES[params[0]?.name]
                          const label = cn ? `${params[0].name}（${cn}）` : params[0]?.name
                          const lines = valid.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
                          const net = valid.reduce((s, p) => s + Number(p.value), 0)
                          lines.push(`合计: ${net.toLocaleString("zh-CN")} 元`)
                          return [label, ...lines].join("<br/>")
                        },
                      },
                      legend: { data: ["多头", "空头"], top: 5, itemWidth: 12, itemGap: 8 },
                      grid: { left: 55, right: 10, top: 30, bottom: 50 },
                      xAxis: {
                        type: "category",
                        data: filteredProdLS.map((p) => p.prod),
                        axisLabel: { fontSize: 10, rotate: 45 },
                      },
                      yAxis: {
                        type: "value",
                        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
                      },
                      series: [
                        {
                          name: "多头",
                          type: "bar",
                          stack: "ls",
                          data: filteredProdLS.map((p) => ({
                            value: p.long,
                            itemStyle: { color: p.long >= 0 ? "#ef4444" : "#22c55e" },
                          })),
                        },
                        {
                          name: "空头",
                          type: "bar",
                          stack: "ls",
                          data: filteredProdLS.map((p) => ({
                            value: p.short,
                            itemStyle: { color: p.short >= 0 ? "#ef444488" : "#22c55e88" },
                          })),
                        },
                      ],
                    }}
                    style={{ height: 240 }}
                    notMerge
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">账户当日盈亏</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ReactECharts
                  option={{
                    tooltip: {
                      trigger: "axis",
                      formatter: (params: { name: string; value: number; marker: string }[]) =>
                        params.map((p) => `${p.marker}${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
                    },
                    grid: { left: 55, right: 10, top: 15, bottom: 60 },
                    xAxis: {
                      type: "category",
                      data: accountLatest.map((a) => a.account),
                      axisLabel: { fontSize: 10, rotate: 30 },
                    },
                    yAxis: {
                      type: "value",
                      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
                    },
                    series: [{
                      type: "bar",
                      data: accountLatest.map((a) => ({
                        value: a.pnl,
                        itemStyle: { color: a.pnl >= 0 ? "#ef4444" : "#22c55e" },
                      })),
                      label: { show: false },
                    }],
                  }}
                  style={{ height: 260 }}
                  notMerge
                />
              </CardContent>
            </Card>
          </div>
          </div>
        )}
      </section>
      <section>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          次日预测
          <span className="h-px flex-1 bg-border" />
          {varBreachRate != null && (
            <span className="text-xs text-muted-foreground font-normal">
              VaR({varConfidence}%) 突破率 {varBreachRate}%
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <label className="text-xs text-muted-foreground">置信度</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varConfidence}
            onChange={(e) => { setVarConfidence(e.target.value); fetchVar(e.target.value, varVolDays, varCorrDays, varDistModel) }}
          >
            <option value="90">90%</option>
            <option value="95">95%</option>
            <option value="99">99%</option>
          </select>
          <label className="text-xs text-muted-foreground ml-2">波动率窗口</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varVolDays}
            onChange={(e) => { setVarVolDays(e.target.value); fetchVar(varConfidence, e.target.value, varCorrDays, varDistModel) }}
          >
            {["5","10","20","30","60"].map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
          <label className="text-xs text-muted-foreground ml-2">相关系数窗口</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varCorrDays}
            onChange={(e) => { setVarCorrDays(e.target.value); fetchVar(varConfidence, varVolDays, e.target.value, varDistModel) }}
          >
            {["5","10","20","30","60","126","252","504"].map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
          <label className="text-xs text-muted-foreground ml-2">分布</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varDistModel}
            onChange={(e) => { setVarDistModel(e.target.value); fetchVar(varConfidence, varVolDays, varCorrDays, e.target.value) }}
          >
            <option value="normal">正态分布</option>
            <option value="t">t 分布 (df=6)</option>
            <option value="laplace">拉普拉斯分布</option>
            <option value="logistic">Logistic 分布</option>
            <option value="kde">核密度估计 KDE</option>
          </select>
          {varLoading && <span className="text-xs text-muted-foreground ml-2">计算中...</span>}
          <button
            className="ml-auto text-xs px-2.5 py-0.5 rounded border border-border hover:bg-muted transition-colors flex items-center gap-1"
            disabled={varOptLoading}
            onClick={() => {
              setVarOptLoading(true)
              setVarOptOpen(true)
              fetch("/ma/api/mom-analysis/var-optimize")
                .then((r) => r.json())
                .then((j) => setVarOptResults(j.results ?? []))
                .catch(() => {})
                .finally(() => setVarOptLoading(false))
            }}
          >
            {varOptLoading ? "搜索中…" : "🔍 最优参数搜索"}
          </button>
        </div>
        {!loading && varData.length > 0 && (() => {
          const ROLL = 20
          // residual = actual - var; positive → breach
          const residuals = varData.map((r) => r.actual - r.var)
          // rolling breach rate: fraction of last ROLL days where actual > var
          const rollBreach = varData.map((_, i) => {
            const window = varData.slice(Math.max(0, i - ROLL + 1), i + 1)
            return Math.round((window.filter((r) => r.actual > r.var).length / window.length) * 1000) / 10
          })
          const handleZoom = (params: { start?: number; end?: number; batch?: { start: number; end: number }[] }) => {
            const s = params.batch ? params.batch[0].start : (params.start ?? varZoom.start)
            const e = params.batch ? params.batch[0].end   : (params.end   ?? varZoom.end)
            setVarZoom({ start: s, end: e })
          }
          return (
            <div className="flex gap-3">
              {/* Left: VaR prediction vs actual */}
              <div className="flex-1 min-w-0">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">VaR({varConfidence}%) 预测 vs 实际 |盈亏|</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    <ReactECharts
                      option={{
                        tooltip: {
                          trigger: "axis",
                          formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
                            const lines = params.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
                            return [params[0]?.name, ...lines].join("<br/>")
                          },
                        },
                        legend: { data: ["实际|盈亏|", `VaR(${varConfidence}%)`], top: 5, itemWidth: 12, itemGap: 8 },
                        grid: { left: 65, right: 20, top: 35, bottom: 50 },
                        xAxis: {
                          type: "category",
                          data: varData.map((r) => r.date),
                          axisLabel: { fontSize: 10, rotate: 30 },
                        },
                        yAxis: {
                          type: "value",
                          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
                        },
                        dataZoom: [
                          { type: "inside", start: varZoom.start, end: varZoom.end },
                          { type: "slider", height: 20, bottom: 5, start: varZoom.start, end: varZoom.end },
                        ],
                        series: [
                          {
                            name: "实际|盈亏|",
                            type: "bar",
                            data: varData.map((r) => ({
                              value: r.actual,
                              itemStyle: { color: r.actual > r.var ? "#ef4444" : "#94a3b8" },
                            })),
                            barMaxWidth: 12,
                          },
                          {
                            name: `VaR(${varConfidence}%)`,
                            type: "line",
                            data: varData.map((r) => r.var),
                            lineStyle: { color: "#f97316", width: 2 },
                            itemStyle: { color: "#f97316" },
                            symbol: "none",
                            z: 10,
                          },
                        ],
                      }}
                      style={{ height: 320 }}
                      notMerge
                      onEvents={{ dataZoom: handleZoom }}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Right: model fit metrics */}
              <div className="flex-1 min-w-0">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        模型拟合评估 — 残差 & 滚动超标率
                        <span className="ml-3 text-muted-foreground font-normal">
                          全期超标率 {varBreachRate != null ? `${varBreachRate}%` : "—"}
                          　期望 {100 - parseInt(varConfidence, 10)}%
                        </span>
                      </CardTitle>
                      <button
                        className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                        onClick={() => setVarFitView(varFitView === "chart" ? "table" : "chart")}
                      >
                        {varFitView === "chart" ? "统计表" : "图表"}
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    {varFitView === "chart" ? (
                    <ReactECharts
                      option={{
                        tooltip: {
                          trigger: "axis",
                          formatter: (params: { seriesName: string; name: string; value: number; marker: string; axisIndex?: number }[]) => {
                            const lines = params.map((p) => {
                              if (p.seriesName === `${ROLL}日滚动超标率`) return `${p.marker}${p.seriesName}: ${p.value}%`
                              return `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`
                            })
                            return [params[0]?.name, ...lines].join("<br/>")
                          },
                        },
                        legend: { data: ["残差 (实际−VaR)", `${ROLL}日滚动超标率`], top: 5, itemWidth: 12, itemGap: 8 },
                        grid: { left: 65, right: 55, top: 35, bottom: 50 },
                        xAxis: {
                          type: "category",
                          data: varData.map((r) => r.date),
                          axisLabel: { fontSize: 10, rotate: 30 },
                        },
                        yAxis: [
                          {
                            type: "value",
                            name: "残差",
                            nameTextStyle: { fontSize: 10 },
                            axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万", fontSize: 10 },
                            splitLine: { lineStyle: { type: "dashed" } },
                          },
                          {
                            type: "value",
                            name: "超标率%",
                            nameTextStyle: { fontSize: 10 },
                            position: "right",
                            axisLabel: { formatter: (v: number) => v + "%", fontSize: 10 },
                            splitLine: { show: false },
                            min: 0,
                            max: 100,
                          },
                        ],
                        dataZoom: [
                          { type: "inside", start: varZoom.start, end: varZoom.end },
                          { type: "slider", height: 20, bottom: 5, start: varZoom.start, end: varZoom.end },
                        ],
                        series: [
                          {
                            name: "残差 (实际−VaR)",
                            type: "bar",
                            yAxisIndex: 0,
                            data: residuals.map((v) => ({
                              value: v,
                              itemStyle: { color: v > 0 ? "#ef4444" : "#22c55e" },
                            })),
                            barMaxWidth: 12,
                          },
                          {
                            name: `${ROLL}日滚动超标率`,
                            type: "line",
                            yAxisIndex: 1,
                            data: rollBreach,
                            lineStyle: { color: "#a78bfa", width: 2 },
                            itemStyle: { color: "#a78bfa" },
                            symbol: "none",
                            z: 10,
                          },
                        ],
                      }}
                      style={{ height: 320 }}
                      notMerge
                      onEvents={{ dataZoom: handleZoom }}
                    />
                    ) : (() => {
                      const N      = varData.length
                      const N1     = varData.filter((r) => r.actual > r.var).length
                      const N0     = N - N1
                      const p_exp  = (100 - parseInt(varConfidence, 10)) / 100
                      const p_obs  = N > 0 ? N1 / N : 0
                      // Kupiec POF LR statistic (chi-squared df=1)
                      const safeLn = (x: number) => x > 0 ? Math.log(x) : -999
                      const lr_pof = N > 0 && N1 > 0 && N0 > 0
                        ? -2 * (N1 * safeLn(p_exp) + N0 * safeLn(1 - p_exp) - N1 * safeLn(p_obs) - N0 * safeLn(1 - p_obs))
                        : 0
                      // Christoffersen independence: consecutive breach runs
                      let T00=0,T01=0,T10=0,T11=0
                      for (let i=1;i<N;i++) {
                        const prev = varData[i-1].actual > varData[i-1].var ? 1 : 0
                        const curr = varData[i].actual   > varData[i].var   ? 1 : 0
                        if (prev===0&&curr===0) T00++
                        else if (prev===0&&curr===1) T01++
                        else if (prev===1&&curr===0) T10++
                        else T11++
                      }
                      const pi01 = T00+T01>0 ? T01/(T00+T01) : 0
                      const pi11 = T10+T11>0 ? T11/(T10+T11) : 0
                      const lr_ind = T01+T11>0 && T00+T10>0
                        ? -2 * (
                            (T00+T01)*safeLn(1-p_obs) + (T01+T11)*safeLn(p_obs)
                            - (T00*safeLn(1-pi01)+(T01>0?T01*safeLn(pi01):0))
                            - (T10*safeLn(1-pi11)+(T11>0?T11*safeLn(pi11):0))
                          )
                        : 0
                      const lr_cc  = lr_pof + lr_ind  // conditional coverage, df=2; crit 5.99
                      // residual stats
                      const mean_r = N > 0 ? residuals.reduce((a,b)=>a+b,0)/N : 0
                      const std_r  = N > 1 ? Math.sqrt(residuals.reduce((a,v)=>a+(v-mean_r)**2,0)/(N-1)) : 0
                      const mae    = N > 0 ? residuals.reduce((a,v)=>a+Math.abs(v),0)/N : 0
                      const rmse   = N > 0 ? Math.sqrt(residuals.reduce((a,v)=>a+v**2,0)/N) : 0
                      const maxBreach = Math.max(0, ...residuals.filter(v=>v>0))
                      const maxBreachDate = maxBreach > 0 ? varData[residuals.indexOf(maxBreach)]?.date ?? "—" : "—"
                      const maxConsec = (() => {
                        let best=0,cur=0
                        for (const r of varData) { cur = r.actual>r.var ? cur+1 : 0; best=Math.max(best,cur) }
                        return best
                      })()
                      const avgVar    = N > 0 ? varData.reduce((a,r)=>a+r.var,0)/N : 0
                      const avgActual = N > 0 ? varData.reduce((a,r)=>a+r.actual,0)/N : 0
                      const fmt = (v: number) => (v/10000).toFixed(2)+"万"
                      const fmtPct = (v: number) => (v*100).toFixed(2)+"%"
                      const cell = "px-3 py-1.5 text-xs"
                      const rows: { label: string; value: string; note?: string; warn?: boolean }[] = [
                        { label: "观测天数 N", value: N.toString() },
                        { label: "超标次数", value: `${N1} 天`, warn: p_obs > p_exp * 1.5 },
                        { label: "实际超标率", value: fmtPct(p_obs), warn: p_obs > p_exp * 1.5 },
                        { label: "期望超标率", value: fmtPct(p_exp) },
                        { label: "最长连续超标", value: `${maxConsec} 天`, warn: maxConsec >= 3 },
                        { label: "Kupiec LR (df=1)", value: lr_pof.toFixed(3), note: lr_pof>6.63?"❌ p<1%":lr_pof>3.84?"⚠ p<5%":"✓ 通过", warn: lr_pof>3.84 },
                        { label: "CC 检验 (df=2)", value: lr_cc.toFixed(3),  note: lr_cc>9.21?"❌ p<1%":lr_cc>5.99?"⚠ p<5%":"✓ 通过",  warn: lr_cc>5.99 },
                        { label: "均值残差", value: fmt(mean_r), note: mean_r>0?"模型倾向低估":"模型倾向高估" },
                        { label: "残差标准差", value: fmt(std_r) },
                        { label: "MAE", value: fmt(mae) },
                        { label: "RMSE", value: fmt(rmse) },
                        { label: "最大超标额", value: maxBreach>0?fmt(maxBreach):"无", note: maxBreach>0?maxBreachDate:undefined, warn: maxBreach>avgVar*2 },
                        { label: "平均 VaR", value: fmt(avgVar) },
                        { label: "平均实际|盈亏|", value: fmt(avgActual) },
                        { label: "覆盖比 (实/VaR)", value: avgVar>0?(avgActual/avgVar).toFixed(3):"—", warn: avgVar>0&&avgActual/avgVar>1 },
                      ]
                      return (
                        <>{(() => {
                          const half = Math.ceil(rows.length / 2)
                          const left = rows.slice(0, half)
                          const right = rows.slice(half)
                          const td = "px-2 py-1 text-xs"
                          const th = "px-2 py-1 text-xs font-medium text-muted-foreground"
                          return (
                            <div className="overflow-y-auto" style={{ height: 320 }}>
                              <table className="w-full text-xs border-collapse">
                                <thead className="sticky top-0 bg-muted/80">
                                  <tr>
                                    <th className={th+" text-left"}>指标</th>
                                    <th className={th+" text-right"}>数值</th>
                                    <th className={th+" text-left"}>说明</th>
                                    <th className={th+" text-left border-l border-border pl-3"}>指标</th>
                                    <th className={th+" text-right"}>数值</th>
                                    <th className={th+" text-left"}>说明</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {left.map((row, i) => {
                                    const r = right[i]
                                    return (
                                      <tr key={row.label} className={i%2===0?"bg-background":"bg-muted/30"}>
                                        <td className={td+" text-muted-foreground whitespace-nowrap"}>{row.label}</td>
                                        <td className={td+" text-right font-mono whitespace-nowrap "+(row.warn?"text-red-500 font-semibold":"")}>{row.value}</td>
                                        <td className={td+" text-muted-foreground/70 whitespace-nowrap"}>{row.note ?? ""}</td>
                                        {r ? (
                                          <>
                                            <td className={td+" text-muted-foreground whitespace-nowrap border-l border-border pl-3"}>{r.label}</td>
                                            <td className={td+" text-right font-mono whitespace-nowrap "+(r.warn?"text-red-500 font-semibold":"")}>{r.value}</td>
                                            <td className={td+" text-muted-foreground/70 whitespace-nowrap"}>{r.note ?? ""}</td>
                                          </>
                                        ) : <td colSpan={3} />}
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )
                        })()}</>
                      )
                    })()}
                  </CardContent>
                </Card>
              </div>
            </div>
          )
        })()}
        {!loading && varData.length === 0 && (
          <p className="text-sm text-muted-foreground">数据不足（需至少 22 个交易日）</p>
        )}

        {/* Optimization results panel */}
        {varOptOpen && (
          <div className="mt-3 border rounded-lg bg-card">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm font-medium">
                最优参数搜索结果
                {varOptLoading
                  ? " — 遍历所有参数组合中…"
                  : varOptResults.length > 0
                  ? ` — 共 ${varOptResults.length} 条（按综合得分排序，越低越好）`
                  : ""}
              </span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setVarOptOpen(false)}
              >
                关闭 ✕
              </button>
            </div>
            {varOptLoading ? (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                正在遍历所有参数组合，通常需要 5–15 秒…
              </div>
            ) : varOptResults.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">无结果</div>
            ) : (() => {
              const DIST_LABEL: Record<string, string> = {
                normal: "正态", t: "t(6)", laplace: "拉普拉斯", logistic: "Logistic", kde: "KDE",
              }
              const th = "px-2 py-1.5 text-xs font-medium text-muted-foreground text-right whitespace-nowrap"
              const td = "px-2 py-1 text-xs text-right whitespace-nowrap"
              return (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-muted/80">
                      <tr>
                        <th className={th + " text-center"}>#</th>
                        <th className={th}>置信度</th>
                        <th className={th}>波动率窗口</th>
                        <th className={th}>相关系数窗口</th>
                        <th className={th}>分布</th>
                        <th className={th}>超标率</th>
                        <th className={th}>期望超标率</th>
                        <th className={th}>Kupiec LR</th>
                        <th className={th}>CC 检验</th>
                        <th className={th}>MAE(万)</th>
                        <th className={th}>RMSE(万)</th>
                        <th className={th}>平均VaR(万)</th>
                        <th className={th}>覆盖比</th>
                        <th className={th + " text-orange-500"}>综合得分</th>
                        <th className={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {varOptResults.map((r, i) => {
                        const bothPass = r.kupiecPass && r.ccPass
                        const isActive =
                          r.confidence === varConfidence &&
                          String(r.volDays) === varVolDays &&
                          String(r.corrDays) === varCorrDays &&
                          r.distModel === varDistModel
                        return (
                          <tr
                            key={i}
                            className={
                              isActive
                                ? "bg-primary/10 font-semibold"
                                : i % 2 === 0
                                ? "bg-background"
                                : "bg-muted/30"
                            }
                          >
                            <td className={td + " text-center text-muted-foreground"}>{i + 1}</td>
                            <td className={td}>{r.confidence}%</td>
                            <td className={td}>{r.volDays > 0 ? `${r.volDays}天` : "—"}</td>
                            <td className={td}>{r.corrDays}天</td>
                            <td className={td}>{DIST_LABEL[r.distModel] ?? r.distModel}</td>
                            <td className={td + (r.breachRate > r.expectedRate * 1.5 ? " text-red-500 font-semibold" : "")}>
                              {r.breachRate}%
                            </td>
                            <td className={td + " text-muted-foreground"}>{r.expectedRate}%</td>
                            <td className={td + (r.kupiecPass ? " text-green-600" : " text-red-500 font-semibold")}>
                              {r.kupiecLR} {r.kupiecPass ? "✓" : "✗"}
                            </td>
                            <td className={td + (r.ccPass ? " text-green-600" : " text-red-500 font-semibold")}>
                              {r.ccLR} {r.ccPass ? "✓" : "✗"}
                            </td>
                            <td className={td}>{r.mae}</td>
                            <td className={td}>{r.rmse}</td>
                            <td className={td}>{r.avgVar}</td>
                            <td className={td + (r.coverageRatio >= 0.7 ? " text-green-600" : r.coverageRatio >= 0.4 ? "" : " text-orange-500")}>
                              {r.coverageRatio}
                            </td>
                            <td className={td + " font-mono " + (bothPass ? "text-green-700" : "text-muted-foreground")}>
                              {r.score}
                            </td>
                            <td className="px-2 py-1">
                              <button
                                className="text-xs px-2 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors whitespace-nowrap"
                                onClick={() => {
                                  setVarConfidence(r.confidence)
                                  setVarVolDays(r.distModel === "kde" ? varVolDays : String(r.volDays))
                                  setVarCorrDays(String(r.corrDays))
                                  setVarDistModel(r.distModel)
                                  fetchVar(
                                    r.confidence,
                                    r.distModel === "kde" ? varVolDays : String(r.volDays),
                                    String(r.corrDays),
                                    r.distModel,
                                  )
                                }}
                              >
                                应用
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        )}
      </section>
    </div>
  )
}

export default function RiskReportNewPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview")
  const activeItem = subNavItems.find((i) => i.key === activeTab)!

  return (
    <div className="flex -mx-6 -mb-6" style={{ height: "calc(100% + 1.5rem)" }}>
      {/* Secondary sidebar */}
      <aside className="w-44 shrink-0 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">MOM 风控报告</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">新版</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {subNavItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                  activeTab === item.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.name}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {activeTab === "overview" && (
          <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b border-border bg-background px-6 py-2">
            <span className="text-xs text-muted-foreground">快捷导航：</span>
            <button
              onClick={() => document.getElementById("section-product")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              产品要素 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-performance")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              业绩指标 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-volatility")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              波动分析 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-pnl")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              分类盈亏 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-top")?.scrollIntoView({ behavior: "smooth" })}
              className="ml-auto rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              ↑ 回到顶部
            </button>
          </div>
        )}
        <h1 id="section-top" className="text-2xl font-semibold tracking-tight pt-6 mb-4">{activeItem.name}</h1>
        {activeTab === "overview" ? (
          <OverviewContent />
        ) : activeTab === "intraday" ? (
          <IntradayContent />
        ) : (
          <PlaceholderContent title={activeItem.name} />
        )}
      </div>
    </div>
  )
}
