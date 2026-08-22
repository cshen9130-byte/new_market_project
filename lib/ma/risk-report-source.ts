"use client"

import { useEffect } from "react"

export type RiskReportVariant = "mom" | "account"

let patched = false
let originalFetch: typeof window.fetch | null = null
let activeCfmmcAccount = ""

/** 资金账号 to append on 单账户 API calls. Empty = 全部账户. */
export function setActiveCfmmcAccount(account: string) {
  activeCfmmcAccount = account.trim()
}

export function getActiveCfmmcAccount(): string {
  return activeCfmmcAccount
}

/**
 * Dedicated CFMMC routes. Any other /ma/api/mom-analysis/* call (except
 * account-risk-import) is rewritten to /ma/api/account-risk/* so the account
 * UI never hits MOM handlers with ?source=account.
 */
const ACCOUNT_RISK_OVERRIDES: Record<string, string> = {
  "product-nav": "/ma/api/account-risk/product-nav",
  "category-pnl": "/ma/api/account-risk/category-pnl",
  "category-exposure": "/ma/api/account-risk/category-exposure",
  "account-daily-pnl": "/ma/api/account-risk/account-daily-pnl",
  "margin-risk": "/ma/api/account-risk/margin-risk",
  "sector-ls-pnl": "/ma/api/account-risk/sector-ls-pnl",
  "position-change": "/ma/api/account-risk/position-change",
  "position-change-detail": "/ma/api/account-risk/position-change-detail",
  "today-position-detail": "/ma/api/account-risk/today-position-detail",
  "option-positions": "/ma/api/account-risk/option-positions",
  "var-sandbox": "/ma/api/account-risk/var-sandbox",
  "var-prediction": "/ma/api/account-risk/var-prediction",
  "vol-corr-scatter": "/ma/api/account-risk/vol-corr-scatter",
  "benchmark": "/ma/api/account-risk/benchmark",
  "var-sector-timeseries": "/ma/api/account-risk/var-sector-timeseries",
  "marginal-vol-timeseries": "/ma/api/account-risk/marginal-vol-timeseries",
  "anomaly-detection": "/ma/api/account-risk/anomaly-detection",
  "liquidity-history": "/ma/api/account-risk/liquidity-history",
  "liquidity-scan": "/ma/api/account-risk/liquidity-scan",
}

function applyAccountParam(dest: URL) {
  if (!dest.pathname.includes("/ma/api/account-risk")) return
  if (dest.pathname.includes("/account-risk/accounts")) return
  dest.searchParams.delete("account")
  dest.searchParams.delete("book")
  if (activeCfmmcAccount.startsWith("book:")) dest.searchParams.set("book", activeCfmmcAccount.slice(5))
  else if (activeCfmmcAccount) dest.searchParams.set("account", activeCfmmcAccount)
}

function rewriteUrl(url: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://local"
    const parsed = new URL(url, base)
    let dest = parsed
    if (parsed.pathname.includes("/ma/api/mom-analysis") && !parsed.pathname.includes("/account-risk-import")) {
      const routeSegment = parsed.pathname.split("/ma/api/mom-analysis/")[1]?.split("?")[0]
      if (routeSegment) {
        dest = new URL(ACCOUNT_RISK_OVERRIDES[routeSegment] ?? `/ma/api/account-risk/${routeSegment}`, base)
        parsed.searchParams.forEach((v, k) => {
          if (k !== "source") dest.searchParams.set(k, v)
        })
      }
    }
    applyAccountParam(dest)
    if (url.startsWith("http://") || url.startsWith("https://")) return dest.toString()
    return dest.pathname + dest.search + dest.hash
  } catch {
    return url
  }
}

function withSourceHeader(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set("x-risk-source", "account")
  headers.delete("x-cfmmc-account")
  headers.delete("x-cfmmc-book")
  if (activeCfmmcAccount.startsWith("book:")) headers.set("x-cfmmc-book", activeCfmmcAccount.slice(5))
  else if (activeCfmmcAccount) headers.set("x-cfmmc-account", activeCfmmcAccount)
  return { ...init, headers }
}

function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const fetchImpl = originalFetch ?? window.fetch.bind(window)
  if (typeof input === "string") {
    return fetchImpl(rewriteUrl(input), withSourceHeader(init))
  }
  if (input instanceof URL) {
    return fetchImpl(rewriteUrl(input.toString()), withSourceHeader(init))
  }
  if (input instanceof Request) {
    const url = rewriteUrl(input.url)
    const headers = new Headers(input.headers)
    headers.set("x-risk-source", "account")
    return fetchImpl(new Request(url, input), withSourceHeader({ ...init, headers }))
  }
  return fetchImpl(input, withSourceHeader(init))
}

function installFetchPatch() {
  if (typeof window === "undefined" || patched) return
  originalFetch = window.fetch.bind(window)
  window.fetch = patchedFetch as typeof window.fetch
  patched = true
}

function uninstallFetchPatch() {
  if (typeof window === "undefined" || !patched || !originalFetch) return
  window.fetch = originalFetch
  originalFetch = null
  patched = false
}

/** Rewrite MOM analysis fetches to the account data source while this page is mounted. */
export function useRiskSourceFetch(variant: RiskReportVariant) {
  if (typeof window !== "undefined" && variant === "account") {
    installFetchPatch()
  }
  useEffect(() => {
    if (variant !== "account") return
    installFetchPatch()
    return () => uninstallFetchPatch()
  }, [variant])
}
