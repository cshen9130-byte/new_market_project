"use client"

import { useEffect } from "react"

export type RiskReportVariant = "mom" | "account"

let patched = false
let originalFetch: typeof window.fetch | null = null
let activeCfmmcAccount = ""
let activeMomSubAccount = ""

/** 资金账号 to append on 单账户 API calls. Empty = 全部账户. */
export function setActiveCfmmcAccount(account: string) {
  activeCfmmcAccount = account.trim()
}

export function getActiveCfmmcAccount(): string {
  return activeCfmmcAccount
}

/** MOM sub-account such as rx000. Empty = keep the 监控中心 account selection. */
export function setActiveMomSubAccount(account: string) {
  activeMomSubAccount = account.trim()
}

export function getActiveMomSubAccount(): string {
  return activeMomSubAccount
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

function relativize(dest: URL, original: string): string {
  if (original.startsWith("http://") || original.startsWith("https://")) return dest.toString()
  return dest.pathname + dest.search + dest.hash
}

function applyCfmmcAccount(dest: URL, cfmmcAccount: string) {
  if (!dest.pathname.includes("/ma/api/account-risk")) return
  if (dest.pathname.includes("/account-risk/accounts")) return
  dest.searchParams.delete("account")
  dest.searchParams.delete("book")
  if (cfmmcAccount.startsWith("book:")) dest.searchParams.set("book", cfmmcAccount.slice(5))
  else if (cfmmcAccount) dest.searchParams.set("account", cfmmcAccount)
}

/**
 * While the 单账户 page is mounted:
 * - a selected MOM sub-account keeps /ma/api/mom-analysis/* and adds ?account=
 * - otherwise those calls are rewritten to /ma/api/account-risk/*
 * The sub-account list itself is never rewritten and never filtered.
 */
export function rewriteRiskFetchUrl(
  url: string,
  momAccount: string,
  cfmmcAccount: string,
): { url: string; accountSource: boolean } {
  try {
    const base = "http://local"
    const parsed = new URL(url, base)
    const path = parsed.pathname

    if (path.includes("/mom-analysis/sub-accounts")) {
      return { url: relativize(parsed, url), accountSource: false }
    }

    if (momAccount && path.includes("/ma/api/mom-analysis") && !path.includes("/account-risk-import")) {
      parsed.searchParams.set("account", momAccount)
      return { url: relativize(parsed, url), accountSource: false }
    }

    let dest = parsed
    if (path.includes("/ma/api/mom-analysis") && !path.includes("/account-risk-import")) {
      const routeSegment = path.split("/ma/api/mom-analysis/")[1]?.split("?")[0]
      if (routeSegment) {
        dest = new URL(ACCOUNT_RISK_OVERRIDES[routeSegment] ?? `/ma/api/account-risk/${routeSegment}`, base)
        parsed.searchParams.forEach((v, k) => {
          if (k !== "source") dest.searchParams.set(k, v)
        })
      }
    }
    applyCfmmcAccount(dest, cfmmcAccount)
    return { url: relativize(dest, url), accountSource: true }
  } catch {
    return { url, accountSource: true }
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

function withoutAccountSource(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.delete("x-risk-source")
  headers.delete("x-cfmmc-account")
  headers.delete("x-cfmmc-book")
  return { ...init, headers }
}

function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const fetchImpl = originalFetch ?? window.fetch.bind(window)
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input instanceof Request
        ? input.url
        : null
  if (rawUrl == null) return fetchImpl(input as RequestInfo, withSourceHeader(init))

  const rewritten = rewriteRiskFetchUrl(rawUrl, activeMomSubAccount, activeCfmmcAccount)
  const nextInit = rewritten.accountSource ? withSourceHeader(init) : withoutAccountSource(init)
  if (typeof input === "string" || input instanceof URL) {
    return fetchImpl(rewritten.url, nextInit)
  }
  const headers = new Headers(input.headers)
  if (rewritten.accountSource) headers.set("x-risk-source", "account")
  else headers.delete("x-risk-source")
  const reqInit = rewritten.accountSource
    ? withSourceHeader({ ...init, headers })
    : withoutAccountSource({ ...init, headers })
  return fetchImpl(new Request(rewritten.url, input), reqInit)
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
