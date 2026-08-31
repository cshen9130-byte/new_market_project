"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { ArrowLeft } from "lucide-react"
import { FundDatabaseShell } from "@/components/ma/fund-database-shell"

type ProductRow = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
}

type ManagerRow = {
  registration_no: string
  manager_name: string
}

function SearchResultsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const q = (searchParams.get("q") || "").trim()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [managers, setManagers] = useState<ManagerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!q) {
      setProducts([])
      setManagers([])
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-funds/global-search?q=${encodeURIComponent(q)}&limit=40`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        if (json?.error) throw new Error("搜索失败")
        setProducts(Array.isArray(json.products) ? json.products : [])
        setManagers(Array.isArray(json.managers) ? json.managers : [])
      })
      .catch((err: Error) => {
        if (cancelled) return
        setProducts([])
        setManagers([])
        setError(err.message || "搜索失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q])

  const navigate = useCallback(
    (tab: string, side?: string) => {
      const sideItem = side ?? "private-funds"
      router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
    },
    [router],
  )

  const total = products.length + managers.length

  return (
    <FundDatabaseShell activeSideItem="private-funds" onNavigate={navigate}>
      <div className="w-full min-w-0">
        <Link
          href="/ma/dashboard/private-funds?tab=funds&side=private-funds"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 mb-4 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回私募基金
        </Link>

        <div className="rounded-xl border border-zinc-100 bg-white px-5 py-5 mb-4">
          <h1 className="text-lg font-semibold text-zinc-900">
            搜索结果
            {q ? <span className="text-zinc-500 font-normal">「{q}」</span> : null}
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            {!q ? "请输入产品名称、备案号或管理人" : loading ? "正在搜索…" : error ? error : `共 ${total} 条结果`}
          </p>
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-10 rounded bg-zinc-100" />
            <div className="h-40 rounded-xl bg-zinc-100" />
          </div>
        ) : !q ? (
          <div className="rounded-xl border border-zinc-100 bg-white px-5 py-10 text-center text-sm text-zinc-400">
            请在菜单栏搜索框输入关键字后按回车
          </div>
        ) : error ? (
          <div className="rounded-xl border border-zinc-100 bg-white px-5 py-10 text-center text-sm text-red-500">
            {error}
          </div>
        ) : total === 0 ? (
          <div className="rounded-xl border border-zinc-100 bg-white px-5 py-10 text-center text-sm text-zinc-400">
            未找到匹配的产品或管理人
          </div>
        ) : (
          <div className="space-y-4">
            {products.length > 0 && (
              <section className="rounded-xl border border-zinc-100 bg-white overflow-hidden">
                <div className="px-5 py-3 border-b border-zinc-100 text-sm font-semibold text-zinc-800">
                  产品
                  <span className="ml-2 text-xs font-normal text-zinc-400">{products.length}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-400">
                      <th className="px-5 py-2 font-medium">产品名称</th>
                      <th className="px-5 py-2 font-medium w-36">备案号</th>
                      <th className="px-5 py-2 font-medium w-40">策略</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((row) => (
                      <tr key={row.beian_hao} className="border-t border-zinc-50 hover:bg-zinc-50/80">
                        <td className="px-5 py-2.5">
                          <Link
                            href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                            className="text-blue-600 hover:underline"
                          >
                            {row.short_name || row.product_name}
                          </Link>
                        </td>
                        <td className="px-5 py-2.5 text-zinc-500 tabular-nums">{row.beian_hao}</td>
                        <td className="px-5 py-2.5 text-zinc-500">{row.strategy_one || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {managers.length > 0 && (
              <section className="rounded-xl border border-zinc-100 bg-white overflow-hidden">
                <div className="px-5 py-3 border-b border-zinc-100 text-sm font-semibold text-zinc-800">
                  管理人
                  <span className="ml-2 text-xs font-normal text-zinc-400">{managers.length}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-400">
                      <th className="px-5 py-2 font-medium">管理人名称</th>
                      <th className="px-5 py-2 font-medium w-40">登记编号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managers.map((row) => (
                      <tr key={row.registration_no} className="border-t border-zinc-50 hover:bg-zinc-50/80">
                        <td className="px-5 py-2.5">
                          <Link
                            href={`/ma/dashboard/private-funds/managers/${encodeURIComponent(row.registration_no)}`}
                            className="text-blue-600 hover:underline"
                          >
                            {row.manager_name}
                          </Link>
                        </td>
                        <td className="px-5 py-2.5 text-zinc-500 tabular-nums">{row.registration_no}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        )}
      </div>
    </FundDatabaseShell>
  )
}

export default function GlobalSearchResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      }
    >
      <SearchResultsContent />
    </Suspense>
  )
}
