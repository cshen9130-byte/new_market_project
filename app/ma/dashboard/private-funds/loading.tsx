export default function PrivateFundsLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden animate-pulse">
      <div className="border-b bg-background flex-shrink-0 h-12 px-6 flex items-center gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-4 w-12 rounded bg-muted" />
        ))}
      </div>
      <div className="flex flex-1 min-h-0">
        <aside className="w-44 border-r flex-shrink-0 p-4 space-y-3">
          <div className="h-7 w-full rounded bg-muted" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 w-3/4 rounded bg-muted/70" />
          ))}
        </aside>
        <div className="flex-1 p-5 space-y-4">
          <div className="rounded-xl border p-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="h-4 w-16 rounded bg-muted shrink-0" />
                <div className="flex gap-2 flex-wrap flex-1">
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <div key={j} className="h-6 w-16 rounded bg-muted/60" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border overflow-hidden">
            <div className="h-10 bg-muted/40 border-b" />
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-12 border-b border-border/40 px-4 flex items-center gap-4">
                <div className="h-4 w-4 rounded bg-muted" />
                <div className="h-4 w-8 rounded bg-muted/70" />
                <div className="h-4 flex-1 max-w-xs rounded bg-muted/70" />
                <div className="h-4 w-20 rounded bg-muted/50" />
                <div className="h-4 w-16 rounded bg-muted/50" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
