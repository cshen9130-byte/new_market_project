"use client"

import { useEffect, useState } from "react"
import { FileSearch } from "lucide-react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  ProductElementsDialogContent,
  type ProductElementsData,
} from "./ProductElementsDialogContent"

type ElementsPayload = ProductElementsData & { error?: string }

function useFundElements(beianHao: string | null, productName: string, enabled: boolean) {
  const [data, setData] = useState<ElementsPayload | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !beianHao) {
      setData(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setData(null)
    const qs = new URLSearchParams({ beian_hao: beianHao })
    if (productName.trim()) qs.set("product_name", productName.trim())
    fetch(`/ma/api/tracking-funds/fund-elements?${qs}`)
      .then(async (r) => {
        const json = (await r.json()) as ElementsPayload
        if (cancelled) return
        setData(json)
      })
      .catch(() => {
        if (cancelled) return
        setData({ error: "加载失败" })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, beianHao, productName])

  return { data, loading }
}

function ElementsBody({
  productName,
  data,
  loading,
  compact,
}: {
  productName: string
  data: ElementsPayload | null
  loading: boolean
  compact?: boolean
}) {
  return (
    <>
      <h2
        className={[
          "font-bold pl-3 border-l-4 border-red-500",
          compact ? "text-sm mb-3" : "text-lg mb-5",
        ].join(" ")}
      >
        {productName || "产品要素"}
      </h2>
      {loading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
          加载中…
        </div>
      )}
      {!loading && data?.error && (
        <div className="text-sm text-muted-foreground py-6 text-center">暂无产品要素数据</div>
      )}
      {!loading && data && !data.error && <ProductElementsDialogContent data={data} />}
    </>
  )
}

/**
 * 操作列「要素表」：点击打开产品要素全量弹窗；悬停预览同一套要素内容。
 * 数据复用 `/ma/api/tracking-funds/fund-elements` + ProductElementsDialogContent。
 */
export function FundElementsAffordance({
  beianHao,
  productName,
  className,
}: {
  beianHao: string | null | undefined
  productName: string
  className?: string
}) {
  const id = (beianHao ?? "").trim()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [hoverOpen, setHoverOpen] = useState(false)
  const fetchEnabled = Boolean(id) && (dialogOpen || hoverOpen)
  const { data, loading } = useFundElements(id || null, productName, fetchEnabled)

  if (!id) {
    return (
      <span
        className={[
          "inline-flex items-center justify-center text-zinc-300 cursor-not-allowed",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        title="无备案号/估值表代码，无法查看要素表"
      >
        <FileSearch className="h-3.5 w-3.5" />
      </span>
    )
  }

  return (
    <>
      <HoverCard
        open={hoverOpen && !dialogOpen}
        onOpenChange={(next) => {
          if (dialogOpen) {
            setHoverOpen(false)
            return
          }
          setHoverOpen(next)
        }}
        openDelay={280}
        closeDelay={120}
      >
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setHoverOpen(false)
              setDialogOpen(true)
            }}
            className={[
              "inline-flex items-center justify-center text-zinc-400 hover:text-red-500 transition-colors",
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            title="要素表"
            aria-label="要素表"
          >
            <FileSearch className="h-3.5 w-3.5" />
          </button>
        </HoverCardTrigger>
        <HoverCardContent
          side="left"
          align="center"
          sideOffset={8}
          className="z-[60] w-[min(92vw,440px)] max-h-[min(70vh,560px)] overflow-y-auto border border-zinc-200 bg-white p-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {hoverOpen && !dialogOpen ? (
            <ElementsBody productName={productName} data={data} loading={loading} compact />
          ) : null}
        </HoverCardContent>
      </HoverCard>

      {dialogOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50"
          onClick={() => setDialogOpen(false)}
        >
          <div
            className="bg-background rounded-lg shadow-2xl w-[780px] max-w-[94vw] max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">产品要素</span>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5">
              <ElementsBody productName={productName} data={data} loading={loading} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
