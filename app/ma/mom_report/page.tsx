"use client"

import { useEffect, useRef, useState } from "react"

export default function MomReportWrapper() {
  const [logs, setLogs] = useState<string[]>(["Wrapper ready"])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const sameOriginRef = useRef<boolean>(true)
  const reportUrl = (process.env.NEXT_PUBLIC_MOM_REPORT_URL || "/mom_report/report.html?v=debug") as string

  useEffect(() => {
    // Determine if the report URL is same-origin; avoid cross-origin fetch/instrumentation
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      const targetOrigin = new URL(reportUrl, origin).origin
      sameOriginRef.current = Boolean(origin) && Boolean(targetOrigin) && origin === targetOrigin
      setLogs((prev) => [...prev.slice(-200), `same-origin: ${sameOriginRef.current}`])
    } catch {
      sameOriginRef.current = true
    }

    // Only fetch to confirm availability if same-origin to avoid CORS issues
    if (sameOriginRef.current) {
      (async () => {
        try {
          const res = await fetch(reportUrl.includes("?") ? reportUrl + "&ping=1" : reportUrl + "?ping=1", { cache: "no-store" })
          setLogs((prev) => [...prev.slice(-200), `fetch report: ${res.status}`])
        } catch (e: any) {
          setLogs((prev) => [...prev.slice(-200), `fetch report error: ${e?.message || e}`])
        }
      })()
    } else {
      setLogs((prev) => [...prev.slice(-200), "skip fetch: cross-origin report URL"])
    }

    function onMessage(ev: MessageEvent) {
      const data = ev.data
      if (data && data.type === "MOM_DEBUG") {
        setLogs((prev) => [...prev.slice(-200), String(data.msg)])
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <div className="flex h-screen w-screen">
      <div className="flex-1 relative">
        <iframe
          ref={iframeRef}
          title="MOM Report"
          src={reportUrl}
          className="absolute inset-0 w-full h-full border-0"
          onLoad={() => {
            try {
              const win = iframeRef.current?.contentWindow
              setLogs((prev) => [...prev.slice(-200), "iframe load fired"])
              if (sameOriginRef.current) {
                const doc = iframeRef.current?.contentDocument || win?.document
                // Instrument child to forward errors even if local shim fails
                if (doc) {
                  const script = doc.createElement("script")
                  script.textContent = `
                    try {
                      window.addEventListener('error', function(e){
                        try { parent.postMessage({ type: 'MOM_DEBUG', msg: 'child error: ' + (e && e.message) }, '*'); } catch(_) {}
                      });
                      window.addEventListener('unhandledrejection', function(e){
                        try { parent.postMessage({ type: 'MOM_DEBUG', msg: 'child rejection: ' + (e && e.reason && e.reason.message) }, '*'); } catch(_) {}
                      });
                      try { parent.postMessage({ type: 'MOM_DEBUG', msg: 'child instrumentation ready' }, '*'); } catch(_) {}
                    } catch(_) {}
                  `
                  doc.head?.appendChild(script)
                  setLogs((prev) => [...prev.slice(-200), "instrumentation injected into child"])
                } else {
                  setLogs((prev) => [...prev.slice(-200), "no access to child document"])
                }
              } else {
                setLogs((prev) => [...prev.slice(-200), "cross-origin: skip child instrumentation"])
              }
              if (win) {
                try { win.postMessage({ type: "MOM_DEBUG_PING" }, "*") } catch {}
                // Send a few more pings in case child loads late
                let tries = 0
                const t = setInterval(() => {
                  try {
                    tries++
                    win.postMessage({ type: "MOM_DEBUG_PING" }, "*")
                    if (tries >= 5) clearInterval(t)
                  } catch {}
                }, 500)
              }
            } catch {}
          }}
        />
      </div>
      <aside className="w-96 border-l bg-black text-green-400 font-mono text-xs overflow-auto">
        <div className="p-2 border-b border-green-700 sticky top-0 bg-black">MOM Report Debug Log</div>
        <div className="p-2 space-y-1">
          {logs.map((l, i) => (
            <div key={i}>[MOM REPORT] {l}</div>
          ))}
          <div className="mt-2">
            <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="underline">Open report.html directly</a>
          </div>
        </div>
      </aside>
    </div>
  )
}
