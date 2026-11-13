"use client"

import { useEffect, useMemo, useState, type MouseEvent } from "react"

export type ApiDocTocItem = {
  id: string
  label: string
  children?: ApiDocTocItem[]
}

function flatten(items: ApiDocTocItem[]): string[] {
  const ids: string[] = []
  for (const item of items) {
    ids.push(item.id)
    if (item.children) ids.push(...flatten(item.children))
  }
  return ids
}

export function ApiDocToc({ items }: { items: ApiDocTocItem[] }) {
  const ids = useMemo(() => flatten(items), [items])
  const [active, setActive] = useState(ids[0] ?? "")

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el))
    if (elements.length === 0) return

    const root = elements[0].closest("main")

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target.id) setActive(visible[0].target.id)
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: "0px 0px -65% 0px",
        threshold: [0, 0.1, 1],
      },
    )
    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [ids])

  function go(id: string, event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    setActive(id)
    // Do not write location.hash / replaceState: this page keeps ?section= in the
    // query, and a URL update makes the settings shell re-apply that section
    // (often 用户中心) and leave the API docs.
  }

  function renderList(list: ApiDocTocItem[], nested = false) {
    return (
      <ul
        className={
          nested
            ? "mt-0.5 mb-1 ml-2 space-y-0.5 border-l border-zinc-200 dark:border-zinc-700 pl-2"
            : "space-y-0.5"
        }
      >
        {list.map((item) => {
          const childActive = item.children?.some((child) => child.id === active)
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(event) => go(item.id, event)}
                className={[
                  "block rounded px-2 py-1 text-xs leading-snug transition-colors",
                  active === item.id
                    ? "text-red-500 font-medium bg-red-50/80 dark:bg-red-950/20"
                    : childActive
                      ? "text-zinc-700 dark:text-zinc-200"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-muted/60",
                ].join(" ")}
              >
                {item.label}
              </a>
              {item.children ? renderList(item.children, true) : null}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <nav
      aria-label="目录"
      className="scrollbar-toc w-44 flex-shrink-0 sticky top-6 self-start max-h-[calc(100vh-8rem)] overflow-y-auto pr-2"
    >
      <p className="px-2 pb-2 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">目录</p>
      {renderList(items)}
    </nav>
  )
}
