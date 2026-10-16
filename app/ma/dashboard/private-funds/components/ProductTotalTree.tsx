"use client"

import {
  emptyNavAge,
  navAgeTree,
  productTotalTree,
  type DataOverviewTreeNode,
  type NavAgePoolCounts,
  type NavClassCounts,
} from "@/lib/ops-data-overview"

function formatCount(count: number): string {
  return count.toLocaleString("zh-CN")
}

function formatShare(count: number, total: number): string {
  if (total <= 0) return "0%"
  const pct = (count / total) * 100
  if (pct >= 99.95) return "100%"
  if (pct > 0 && pct < 0.1) return "<0.1%"
  return `${pct.toFixed(1)}%`
}

const TONE: Record<string, string> = {
  total: "bg-zinc-800 text-zinc-50",
  private: "bg-rose-800 text-rose-50",
  "private/present": "bg-rose-600 text-rose-50",
  "private/absent": "bg-rose-200 text-rose-900",
  "private/present/in": "bg-rose-700 text-rose-50",
  "private/present/out": "bg-rose-100 text-rose-900",
  "private/absent/in": "bg-rose-400 text-rose-50",
  "private/absent/out": "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  other: "bg-zinc-600 text-zinc-50",
  "other/present": "bg-zinc-500 text-zinc-50",
  "other/absent": "bg-zinc-200 text-zinc-700",
  "other/present/in": "bg-zinc-700 text-zinc-50",
  "other/present/out": "bg-zinc-100 text-zinc-700",
  "other/absent/in": "bg-zinc-400 text-zinc-50",
  "other/absent/out": "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200",
  present: "bg-zinc-800 text-zinc-50",
  "present/m1": "bg-rose-700 text-rose-50",
  "present/m1_3": "bg-rose-600 text-rose-50",
  "present/m3_6": "bg-rose-500 text-rose-50",
  "present/over_m6": "bg-rose-400 text-rose-50",
  "present/none": "bg-rose-300 text-rose-900",
  "present/m1/in": "bg-rose-800 text-rose-50",
  "present/m1/out": "bg-rose-100 text-rose-900",
  "present/m1_3/in": "bg-rose-700 text-rose-50",
  "present/m1_3/out": "bg-rose-100 text-rose-900",
  "present/m3_6/in": "bg-rose-600 text-rose-50",
  "present/m3_6/out": "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  "present/over_m6/in": "bg-rose-500 text-rose-50",
  "present/over_m6/out": "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  "present/none/in": "bg-rose-400 text-rose-50",
  "present/none/out": "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
}

function toneFor(path: string): string {
  return TONE[path] ?? TONE[path.replace(/^[^/]+\//, "")] ?? TONE.other
}

function Node({
  node,
  total,
  path,
  compact = false,
}: {
  node: DataOverviewTreeNode
  total: number
  path: string
  compact?: boolean
}) {
  return (
    <div className={`mx-1 rounded-md text-center shadow-sm ${compact ? "w-[6.75rem] px-1.5 py-2" : "w-[8.5rem] px-2 py-2"} ${toneFor(path)}`}>
      <div className={`whitespace-nowrap font-semibold leading-4 ${compact ? "text-[11px]" : "text-xs"}`}>{node.label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums leading-5 ${compact ? "text-sm" : "text-base"}`}>{formatCount(node.count)}</div>
      <div className="text-[11px] tabular-nums opacity-80 leading-4">{formatShare(node.count, total)}</div>
    </div>
  )
}

const LINE = "bg-zinc-300 dark:bg-zinc-600"

function Level({
  nodes,
  total,
  parentPath,
}: {
  nodes: DataOverviewTreeNode[]
  total: number
  parentPath: string
}) {
  return (
    <div className="flex w-full items-start">
      {nodes.map((node, index) => {
        const path = parentPath ? `${parentPath}/${node.key}` : node.key
        const children = node.children ?? []
        const edge = nodes.length === 1 ? "only" : index === 0 ? "first" : index === nodes.length - 1 ? "last" : "mid"
        const rail = edge === "only" ? "hidden" : edge === "first" ? "left-1/2 right-0" : edge === "last" ? "left-0 right-1/2" : "inset-x-0"
        return (
          <div key={node.key} className="relative flex min-w-max flex-1 flex-col items-center">
            <div className={`absolute top-0 h-px ${rail} ${LINE}`} />
            <div className={`h-4 w-px ${LINE}`} />
            <Node node={node} total={total} path={path} compact={children.length === 0} />
            {children.length > 0 && (
              <>
                <div className={`h-4 w-px ${LINE}`} />
                <Level nodes={children} total={total} parentPath={path} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TreeChart({ root }: { root: DataOverviewTreeNode }) {
  const children = root.children ?? []
  if (children.length === 0) return null
  return (
    <div className="w-full overflow-x-auto px-4 py-5">
      <div className="mx-auto flex w-full min-w-max flex-col items-center">
        <Node node={root} total={root.count} path={root.key} />
        <div className={`h-4 w-px ${LINE}`} />
        <Level nodes={children} total={root.count} parentPath={root.key} />
      </div>
    </div>
  )
}

export function ProductTotalTree({ total, navClass }: { total: number; navClass: NavClassCounts }) {
  return <TreeChart root={productTotalTree(total, navClass)} />
}

export function NavAgeTree({ ages }: { ages?: NavAgePoolCounts | null }) {
  return <TreeChart root={navAgeTree(ages ?? emptyNavAge())} />
}
