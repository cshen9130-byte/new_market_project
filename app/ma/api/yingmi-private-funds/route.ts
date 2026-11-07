import { NextResponse } from "next/server"
import { shortStrategy, type YingmiProduct } from "@/lib/ma/yingmi-private-fund"
import {
  hasYingmiCredential,
  listYingmiProducts,
  readYingmiSync,
  seedYingmiProducts,
  YINGMI_SEED_META,
  type YingmiSyncRow,
} from "@/lib/server/yingmi-private-fund-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    let connected = false
    let sync: YingmiSyncRow = {
      status: "idle",
      lastError: null,
      updatedAt: null,
      state: {
        runStartedOn: null,
        finishedOn: null,
        callsDay: null,
        callsToday: 0,
        strategies: [],
        progress: {},
        tree: null,
      },
    }
    let dbRows: YingmiProduct[] = []
    try {
      ;[connected, sync, dbRows] = await Promise.all([
        hasYingmiCredential(),
        readYingmiSync(),
        listYingmiProducts(),
      ])
    } catch (err) {
      console.error("[yingmi-private-funds] database", err)
      sync.lastError = "服务器数据库还不能写入盈米表，先显示 11 月 7 日的快照"
    }
    const products = mergeProducts(dbRows, sync.status)
    const peers = [...new Set(products.map((row) => row.strategyLevel1))]
    const counts = new Map<string, number>()
    for (const row of products) counts.set(row.strategyLevel1, (counts.get(row.strategyLevel1) || 0) + 1)
    return NextResponse.json({
      connected,
      status: sync.status,
      lastError: sync.lastError,
      updatedAt: sync.updatedAt,
      callsToday: sync.state.callsToday,
      callsDay: sync.state.callsDay,
      runStartedOn: sync.state.runStartedOn,
      finishedOn: sync.state.finishedOn,
      treeTotal: sync.status === "complete" ? products.length : YINGMI_SEED_META.treeTotal,
      seedAsOf: YINGMI_SEED_META.asOf,
      count: products.length,
      strategies: [...counts.entries()].map(([full, count]) => ({
        full,
        label: shortStrategy(full, peers),
        count,
      })),
      products: products.map((row) => ({
        ...row,
        strategyLabel: shortStrategy(row.strategyLevel1, peers),
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[yingmi-private-funds]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function mergeProducts(dbRows: YingmiProduct[], status: string): YingmiProduct[] {
  if (status === "complete" && dbRows.length > 0) return dbRows
  const names = new Set(dbRows.map((row) => row.fundName))
  const seed = seedYingmiProducts().filter((row) => !names.has(row.fundName))
  return [...dbRows, ...seed].sort((a, b) => {
    const strategy = a.strategyLevel1.localeCompare(b.strategyLevel1, "zh")
    if (strategy) return strategy
    return (b.setupDate || "").localeCompare(a.setupDate || "") || a.fundName.localeCompare(b.fundName, "zh")
  })
}
