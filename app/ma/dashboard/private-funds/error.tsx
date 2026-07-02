"use client"

import { useEffect } from "react"
import { clearMaClientCaches } from "@/lib/ma/client-storage-recovery"

export default function PrivateFundsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[private-funds]", error)
  }, [error])

  function handleClearCacheAndRetry() {
    clearMaClientCaches()
    reset()
  }

  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-base font-medium text-foreground">投资页面加载失败</p>
      <p className="max-w-md text-sm text-muted-foreground">
        通常是本机浏览器缓存了损坏的本地数据。点击下方按钮清除相关缓存并重试（不会退出登录）。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleClearCacheAndRetry}
          className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
        >
          清除缓存并重试
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          直接重试
        </button>
      </div>
    </div>
  )
}
