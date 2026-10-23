export type MobileNavTarget = {
  path: string
  label: string
}

/**
 * Map web dashboard hrefs from /ma/api/chat navigate events
 * onto expo-router paths used by the mobile app.
 */
export function mapChatHrefToMobile(href: string, title?: string): MobileNavTarget | null {
  const raw = String(href || "").trim()
  if (!raw) return null
  const pathOnly = raw.split("?")[0].replace(/\/$/, "")

  const fundMatch = pathOnly.match(/\/ma\/dashboard\/private-funds\/([^/]+)$/i)
  if (fundMatch?.[1] && fundMatch[1] !== "search" && fundMatch[1] !== "managers") {
    const code = decodeURIComponent(fundMatch[1])
    return { path: `/fund/${encodeURIComponent(code)}`, label: title || code }
  }

  const rules: Array<{ test: string; path: string; label: string }> = [
    { test: "/ma/dashboard/ai-knowledge", path: "/knowledge", label: "AI\u77e5\u8bc6\u5e93" },
    { test: "/ma/dashboard/ai-researcher", path: "/researcher", label: "AI\u7814\u7a76\u5458" },
    { test: "/ma/dashboard/all-weather", path: "/all-weather", label: "\u5168\u5929\u5019\u8ddf\u8e2a" },
    { test: "/ma/dashboard/realtime-quotes", path: "/quotes", label: "\u5b9e\u65f6\u884c\u60c5" },
    { test: "/ma/dashboard/mom-analysis", path: "/mom", label: "MOM\u5206\u6790" },
    { test: "/ma/dashboard/private-funds", path: "/private-funds", label: "\u79c1\u52df\u57fa\u91d1" },
    { test: "/ma/dashboard", path: "/(tabs)/home", label: "\u9996\u9875" },
  ]

  for (const rule of rules) {
    if (pathOnly === rule.test || pathOnly.startsWith(rule.test + "/")) {
      return { path: rule.path, label: title || rule.label }
    }
  }

  const t = String(title || "")
  if (/\u77e5\u8bc6\u5e93/.test(t)) return { path: "/knowledge", label: t || "AI\u77e5\u8bc6\u5e93" }
  if (/\u7814\u7a76\u5458/.test(t)) return { path: "/researcher", label: t || "AI\u7814\u7a76\u5458" }
  if (/\u79c1\u52df/.test(t)) return { path: "/private-funds", label: t || "\u79c1\u52df\u57fa\u91d1" }
  if (/MOM/.test(t)) return { path: "/mom", label: t || "MOM\u5206\u6790" }
  if (/\u884c\u60c5/.test(t)) return { path: "/quotes", label: t || "\u5b9e\u65f6\u884c\u60c5" }
  if (/\u5168\u5929\u5019/.test(t)) return { path: "/all-weather", label: t || "\u5168\u5929\u5019\u8ddf\u8e2a" }

  return null
}
