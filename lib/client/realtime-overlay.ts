import { INDEX_FUTURES, type IndexProduct } from "@/lib/client/ctp-market"

export const INDEX_SPOT = {
  IH: { sina: "sh000016", name: "上证50指数" },
  IF: { sina: "sh000300", name: "沪深300指数" },
  IC: { sina: "sh000905", name: "中证500指数" },
  IM: { sina: "sh000852", name: "中证1000指数" },
} as const satisfies Record<IndexProduct, { sina: string; name: string }>

export const INDEX_IV = {
  IH: { key: "50index", fallback: "50etf", option: "HO", name: "上证50股指期权 QVIX" },
  IF: { key: "300index", fallback: "300etf", option: "IO", name: "沪深300股指期权 QVIX" },
  IC: { key: "500etf", fallback: "500etf", option: "510500", name: "中证500ETF期权 QVIX" },
  IM: { key: "1000index", fallback: "1000index", option: "MO", name: "中证1000股指期权 QVIX" },
} as const satisfies Record<
  IndexProduct,
  { key: string; fallback: string; option: string; name: string }
>

export const INDEX_CHART_COLOR: Record<IndexProduct, string> = {
  IH: "#2563eb",
  IF: "#0d9488",
  IC: "#d97706",
  IM: "#e11d48",
}

export type OverlayPoint = { time: number; close: number }

export type SpotSnapshot = {
  product: IndexProduct
  sina: string
  name: string
  price: number | null
  preClose: number | null
  change: number | null
  pct: number | null
  updateTime: string | null
  bars: OverlayPoint[]
}

export type IvSnapshot = {
  product: IndexProduct
  key: string
  option: string
  name: string
  value: number | null
  change: number | null
  pct: number | null
  source: string | null
  bars: OverlayPoint[]
}

export type LiveOverlayResponse = {
  ok?: boolean
  error?: string
  spots?: Record<string, SpotSnapshot>
  iv?: Record<string, IvSnapshot>
}

export const INDEX_PRODUCTS = INDEX_FUTURES.map((item) => item.product)
