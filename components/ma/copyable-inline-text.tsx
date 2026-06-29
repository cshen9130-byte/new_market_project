"use client"

import { useState, type MouseEvent, type ReactNode } from "react"
import { Copy, Check } from "lucide-react"

/**
 * Copy text to the clipboard with a fallback for insecure (plain-HTTP) origins.
 * `navigator.clipboard` only exists in secure contexts (HTTPS / localhost), so
 * on the internal HTTP server it is undefined — we fall back to a hidden
 * textarea + document.execCommand("copy").
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to legacy path
    }
  }
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "-9999px"
    textarea.style.left = "-9999px"
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

export function CopyableInlineText({
  text,
  copyTitle,
  label,
}: {
  text: string
  copyTitle: string
  label: ReactNode
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="group/copy inline-flex items-center max-w-full align-top">
      {label}
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "已复制" : copyTitle}
        className="flex-shrink-0 ml-0.5 p-0.5 rounded opacity-0 group-hover/copy:opacity-100 hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-opacity"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}

export function CopyableProductName({
  beian_hao,
  product_name,
  short_name,
  className,
}: {
  beian_hao: string
  product_name: string
  short_name?: string | null
  className?: string
}) {
  const displayName = short_name || product_name
  return (
    <CopyableInlineText
      text={product_name}
      copyTitle="复制产品名称"
      label={
        <a
          href={`/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={className ?? "truncate min-w-0 font-medium text-blue-600 dark:text-blue-400 hover:underline leading-5 block"}
          title={product_name}
        >
          {displayName}
        </a>
      }
    />
  )
}

export function CopyableProductText({
  product_name,
  className,
}: {
  product_name: string
  className?: string
}) {
  return (
    <CopyableInlineText
      text={product_name}
      copyTitle="复制产品名称"
      label={
        <span className={className ?? "truncate min-w-0 block"} title={product_name}>
          {product_name}
        </span>
      }
    />
  )
}

export function FundProductNameLink({
  beian_hao,
  product_name,
  short_name,
  className,
}: {
  beian_hao: string | null
  product_name: string
  short_name?: string | null
  className?: string
}) {
  const label = short_name || product_name
  const href = `/ma/dashboard/private-funds/${encodeURIComponent(beian_hao || product_name)}`
  return (
    <div className={className ?? "max-w-[200px]"}>
      <CopyableInlineText
        text={product_name}
        copyTitle="复制产品名称"
        label={
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate min-w-0 font-medium text-blue-600 dark:text-blue-400 hover:underline leading-5"
            title={product_name}
          >
            {label}
          </a>
        }
      />
      {beian_hao && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <span className="text-[10px] text-muted-foreground tabular-nums leading-4 block truncate">
            {beian_hao}
          </span>
        </a>
      )}
    </div>
  )
}
