"use client"

import { useEffect } from "react"

export type RiskReportVariant = "mom" | "account"

let patched = false
let originalFetch: typeof window.fetch | null = null

/**
 * Routes that have dedicated account-risk equivalents returning CFMMC data.
 * These are redirected to /ma/api/account-risk/* instead of going through the
 * MOM routes with ?source=account (which would need mom_fund_transactions etc.).
 */
const ACCOUNT_RISK_OVERRIDES: Record<string, string> = {
  "product-nav": "/ma/api/account-risk/product-nav",
}

function rewriteUrl(url: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://local"
    const parsed = new URL(url, base)
    if (!parsed.pathname.includes("/ma/api/mom-analysis")) return url

    // Check for dedicated account-risk overrides first
    const routeSegment = parsed.pathname.split("/ma/api/mom-analysis/")[1]?.split("?")[0]
    if (routeSegment && ACCOUNT_RISK_OVERRIDES[routeSegment]) {
      const override = ACCOUNT_RISK_OVERRIDES[routeSegment]
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return new URL(override, base).toString()
      }
      return override
    }

    // Default: add ?source=account so the MOM route uses account_risk schema
    parsed.searchParams.set("source", "account")
    if (url.startsWith("http://") || url.startsWith("https://")) return parsed.toString()
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return url
  }
}

function withSourceHeader(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set("x-risk-source", "account")
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
