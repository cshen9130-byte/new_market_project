"use client"

import { useEffect, useState } from "react"
import { Inbox } from "lucide-react"

interface NewsItem {
  id: string
  title: string
  published_at: string
  source: string
  summary: string | null
  url: string | null
}

interface NewsData {
  disclaimer: string
  items: NewsItem[]
}

export function ManagerNewsPanel({ registrationNo }: { registrationNo: string }) {
  const [data, setData] = useState<NewsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-fund-managers/${encodeURIComponent(registrationNo)}/news`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json() as Promise<NewsData>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [registrationNo])

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-100 bg-white w-full animate-pulse">
        <div className="h-12 m-5 rounded bg-amber-50" />
        <div className="h-48 mx-5 mb-5 rounded bg-zinc-100" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-40 text-red-500 text-sm rounded-lg border border-zinc-100 bg-white w-full">
        加载失败：{error ?? "未知错误"}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-100 bg-white w-full min-h-[420px] flex flex-col">
      <div className="mx-5 mt-5 mb-4 rounded-md border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed">
        {data.disclaimer}
      </div>

      {data.items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-zinc-400">
          <Inbox className="h-12 w-12 opacity-30 mb-3" strokeWidth={1} />
          <span className="text-sm">暂无数据</span>
        </div>
      ) : (
        <div className="px-5 pb-5 space-y-3">
          {data.items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-zinc-100 px-4 py-3 hover:bg-zinc-50/60 transition-colors"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 mb-1.5">
                <span className="tabular-nums">{item.published_at}</span>
                <span>{item.source}</span>
              </div>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-blue-600 hover:underline leading-snug"
                >
                  {item.title}
                </a>
              ) : (
                <h3 className="text-sm font-medium text-zinc-800 leading-snug">{item.title}</h3>
              )}
              {item.summary?.trim() && (
                <p className="text-sm text-zinc-500 mt-2 leading-relaxed line-clamp-3">{item.summary}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
