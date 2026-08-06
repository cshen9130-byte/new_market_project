import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import { fmtIso, n, query, rawQuery } from "@/lib/db"
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

const execFileAsync = promisify(execFile)

export type SectorBoardType = "industry" | "concept"

export type SectorCrowdingBoard = {
  type: SectorBoardType
  name: string
  group: string
}

/** Curated boards for the AI / crowding narrative chart. */
export const SECTOR_CROWDING_BOARDS: SectorCrowdingBoard[] = [
  { type: "concept", name: "人工智能", group: "AI主题" },
  { type: "concept", name: "共封装光学(CPO)", group: "AI主题" },
  { type: "concept", name: "东数西算(算力)", group: "AI主题" },
  { type: "concept", name: "AI应用", group: "AI主题" },
  { type: "concept", name: "数据中心(AIDC)", group: "AI主题" },
  { type: "concept", name: "算力租赁", group: "AI主题" },
  { type: "concept", name: "华为概念", group: "AI主题" },
  { type: "concept", name: "存储芯片", group: "AI主题" },
  { type: "industry", name: "半导体", group: "相关行业" },
  { type: "industry", name: "通信设备", group: "相关行业" },
  { type: "industry", name: "元件", group: "相关行业" },
  { type: "industry", name: "软件开发", group: "相关行业" },
  { type: "industry", name: "光学光电子", group: "相关行业" },
  { type: "industry", name: "计算机设备", group: "相关行业" },
  { type: "industry", name: "消费电子", group: "相关行业" },
]

type PythonInvocation = { executable: string; prefixArgs: string[] }

type BackfillCache = {
  inflight: Map<string, Promise<void>>
}

function getBackfillCache(): BackfillCache {
  const g = globalThis as typeof globalThis & { __ashareSectorAmountBackfill?: BackfillCache }
  if (!g.__ashareSectorAmountBackfill) {
    g.__ashareSectorAmountBackfill = { inflight: new Map() }
  }
  return g.__ashareSectorAmountBackfill
}

function pushPythonCandidate(out: PythonInvocation[], executable: string, prefixArgs: string[] = []) {
  if (!executable || (executable.includes(path.sep) && !existsSync(executable))) return
  if (out.some((item) => item.executable === executable && item.prefixArgs.join(" ") === prefixArgs.join(" "))) {
    return
  }
  out.push({ executable, prefixArgs })
}

function listPythonCandidates(): PythonInvocation[] {
  const cwd = process.cwd()
  const out: PythonInvocation[] = []
  for (const key of ["PYTHON_EXE", "PYTHON_EXECUTABLE"] as const) {
    pushPythonCandidate(out, process.env[key] ?? "")
  }
  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, "py", ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
    pushPythonCandidate(out, "python3")
  }
  return out
}

async function findPython(): Promise<PythonInvocation> {
  for (const candidate of listPythonCandidates()) {
    try {
      await execFileAsync(
        candidate.executable,
        [...candidate.prefixArgs, "-c", "import akshare"],
        { timeout: 15_000 },
      )
      return candidate
    } catch {
      // next
    }
  }
  throw new Error("Python with akshare not found")
}

async function ensureTable(): Promise<void> {
  await rawQuery(`
    CREATE TABLE IF NOT EXISTS derived_ashare_board_amount_daily (
      trade_date   DATE         NOT NULL,
      board_type   VARCHAR(20)  NOT NULL,
      board_name   VARCHAR(100) NOT NULL,
      amount       NUMERIC(20,2),
      change_pct   NUMERIC(10,4),
      close        NUMERIC(16,4),
      source       VARCHAR(60),
      fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date, board_type, board_name)
    )
  `)
  await rawQuery(`
    CREATE INDEX IF NOT EXISTS derived_ashare_board_amount_daily_lookup_idx
      ON derived_ashare_board_amount_daily (board_type, board_name, trade_date DESC)
  `)
}

async function countBoardDates(
  boardType: SectorBoardType,
  boardName: string,
  days: number,
): Promise<number> {
  const rows = await query<{ n: string | number }>(
    `SELECT COUNT(*) AS n
     FROM derived_ashare_board_amount_daily
     WHERE board_type = $1
       AND board_name = $2
       AND amount IS NOT NULL
       AND trade_date >= CURRENT_DATE - ($3 || ' days')::interval`,
    [boardType, boardName, days],
  )
  return Number(rows[0]?.n ?? 0)
}

async function backfillBoard(
  boardType: SectorBoardType,
  boardName: string,
  days: number,
): Promise<void> {
  loadProjectEnvFiles()
  const { executable, prefixArgs } = await findPython()
  const scriptPath = path.join(process.cwd(), "scripts", "ma", "backfill_ashare_board_amount_hist.py")
  const env = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    TQDM_DISABLE: "1",
  }
  const { stdout, stderr } = await execFileAsync(
    executable,
    [
      ...prefixArgs,
      scriptPath,
      "--type",
      boardType,
      "--board",
      boardName,
      "--days",
      String(days),
    ],
    {
      cwd: process.cwd(),
      env,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  if (stderr?.trim()) {
    console.warn("[sector-crowding] backfill stderr:", stderr.trim().slice(-1500))
  }
  const text = (stdout || "").trim()
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first < 0 || last <= first) throw new Error("board amount backfill: no JSON")
  const payload = JSON.parse(text.slice(first, last + 1)) as { error?: string; rows?: number }
  if (payload.error) throw new Error(payload.error)
}

async function ensureBoardHistory(
  boardType: SectorBoardType,
  boardName: string,
  days: number,
): Promise<boolean> {
  await ensureTable()
  const minDates = Math.min(days, Math.max(40, Math.floor(days * 0.35)))
  const coverage = await countBoardDates(boardType, boardName, days + 20)
  if (coverage >= minDates) return false

  const key = `${boardType}:${boardName}:${days}`
  const cache = getBackfillCache()
  let inflight = cache.inflight.get(key)
  if (!inflight) {
    inflight = backfillBoard(boardType, boardName, Math.max(days, 120)).finally(() => {
      cache.inflight.delete(key)
    })
    cache.inflight.set(key, inflight)
  }
  await inflight
  return true
}

function resolveBoard(
  boardType?: string | null,
  boardName?: string | null,
): SectorCrowdingBoard {
  const type = boardType === "industry" ? "industry" : boardType === "concept" ? "concept" : null
  const name = (boardName || "").trim()
  if (type && name) {
    const known = SECTOR_CROWDING_BOARDS.find((b) => b.type === type && b.name === name)
    if (known) return known
    return { type, name, group: type === "concept" ? "概念" : "行业" }
  }
  return SECTOR_CROWDING_BOARDS[0]
}

export async function getAshareSectorCrowding(options?: {
  boardType?: string | null
  boardName?: string | null
  days?: number
  hotTopN?: number
  autoBackfill?: boolean
}): Promise<{
  board: SectorCrowdingBoard
  days: number
  hot_top_n: number
  start_date: string | null
  end_date: string | null
  latest: {
    trade_date: string | null
    amount_share: number | null
    crowding_pct: number | null
    amount: number | null
    total_amount: number | null
    change_pct: number | null
    is_hot: boolean
  }
  series: Array<{
    date: string
    amount_share: number | null
    crowding_pct: number | null
    amount: number | null
    total_amount: number | null
    change_pct: number | null
    rank: number | null
    is_hot: boolean
  }>
  boards: SectorCrowdingBoard[]
  backfilled: boolean
  note: string | null
}> {
  const board = resolveBoard(options?.boardType, options?.boardName)
  const days = Math.min(500, Math.max(60, options?.days ?? 365))
  const hotTopN = Math.min(30, Math.max(3, options?.hotTopN ?? 10))
  const autoBackfill = options?.autoBackfill !== false

  let backfilled = false
  let note: string | null = null
  if (autoBackfill) {
    try {
      backfilled = await ensureBoardHistory(board.type, board.name, days)
    } catch (e) {
      note = e instanceof Error ? e.message : "板块成交额历史回填失败"
    }
  }

  const crowdingRows = await query<{
    trade_date: Date | string
    total_amount: string | number | null
    crowding_smooth: string | number | null
    crowding_pct: string | number | null
  }>(
    `SELECT trade_date, total_amount, crowding_smooth, crowding_pct
     FROM derived_ashare_crowding_daily
     ORDER BY trade_date DESC
     LIMIT $1`,
    [days],
  )

  const boardRows = await query<{
    trade_date: Date | string
    amount: string | number | null
    change_pct: string | number | null
  }>(
    `SELECT trade_date, amount, change_pct
     FROM derived_ashare_board_amount_daily
     WHERE board_type = $1 AND board_name = $2
     ORDER BY trade_date DESC
     LIMIT $3`,
    [board.type, board.name, days],
  )

  // Hot ranks from hot-sectors table when available (industry hist coverage is best).
  const hotRows = await query<{
    trade_date: Date | string
    rank_no: number | null
    change_pct: string | number | null
  }>(
    `SELECT trade_date, rank_no, change_pct
     FROM derived_ashare_hot_sectors_daily
     WHERE board_type = $1 AND board_name = $2
     ORDER BY trade_date DESC
     LIMIT $3`,
    [board.type, board.name, days],
  )

  const crowdingByDate = new Map(
    crowdingRows.map((r) => [
      fmtIso(r.trade_date),
      {
        total_amount: n(r.total_amount),
        crowding_pct: n(r.crowding_smooth) ?? n(r.crowding_pct),
      },
    ]),
  )
  const boardByDate = new Map(
    boardRows.map((r) => [
      fmtIso(r.trade_date),
      { amount: n(r.amount), change_pct: n(r.change_pct) },
    ]),
  )
  const hotByDate = new Map(
    hotRows.map((r) => [
      fmtIso(r.trade_date),
      { rank: r.rank_no, change_pct: n(r.change_pct) },
    ]),
  )

  // Prefer crowding calendar (has total_amount) as the spine.
  const dates = [...crowdingByDate.keys()].sort()
  const series = dates.map((date) => {
    const c = crowdingByDate.get(date)
    const b = boardByDate.get(date)
    const h = hotByDate.get(date)
    const amount = b?.amount ?? null
    const total = c?.total_amount ?? null
    const amountShare =
      amount != null && total != null && total > 0 ? (amount / total) * 100 : null
    const rank = h?.rank ?? null
    const changePct = b?.change_pct ?? h?.change_pct ?? null
    // Fallback hot flag from board change ranking is unavailable; use stored rank,
    // or approximate: change_pct among top if we only have board change (skip).
    const isHot = rank != null && rank <= hotTopN
    return {
      date,
      amount_share: amountShare != null ? Number(amountShare.toFixed(3)) : null,
      crowding_pct: c?.crowding_pct ?? null,
      amount,
      total_amount: total,
      change_pct: changePct,
      rank,
      is_hot: isHot,
    }
  })

  // If board amount series is much shorter, note it.
  const amountPoints = series.filter((s) => s.amount_share != null).length
  if (!note && amountPoints < Math.min(40, Math.floor(days * 0.2))) {
    note = `该板块成交额历史仅 ${amountPoints} 个交易日，图线可能较短`
  }

  // If cross-section ranks are missing (common for concepts), rank this board
  // against other curated boards of the same type that have amount history.
  const hasAnyRank = series.some((s) => s.rank != null)
  if (!hasAnyRank) {
    const peerNames = SECTOR_CROWDING_BOARDS.filter((b) => b.type === board.type).map((b) => b.name)
    const peerRows = await query<{
      trade_date: Date | string
      board_name: string
      change_pct: string | number | null
    }>(
      `SELECT trade_date, board_name, change_pct
       FROM derived_ashare_board_amount_daily
       WHERE board_type = $1
         AND board_name = ANY($2::text[])
         AND change_pct IS NOT NULL
         AND trade_date = ANY($3::date[])`,
      [board.type, peerNames, dates],
    )
    const byDate = new Map<string, Array<{ name: string; chg: number }>>()
    for (const r of peerRows) {
      const chg = n(r.change_pct)
      if (chg == null) continue
      const d = fmtIso(r.trade_date)
      const list = byDate.get(d) ?? []
      list.push({ name: r.board_name, chg })
      byDate.set(d, list)
    }
    for (const s of series) {
      const list = byDate.get(s.date)
      if (!list?.length) continue
      const sorted = [...list].sort((a, b) => b.chg - a.chg)
      const idx = sorted.findIndex((x) => x.name === board.name)
      if (idx >= 0) {
        const rank = idx + 1
        s.rank = rank
        s.is_hot = rank <= Math.min(hotTopN, Math.max(3, Math.ceil(sorted.length * 0.35)))
      }
    }
    if (!note) {
      note = "粉色标记：该板块在监控篮子内涨跌幅靠前的交易日（完整全市场排名回填前的近似）"
    }
  }

  const withShare = series.filter((s) => s.amount_share != null)
  const latestPoint = [...series].reverse().find((s) => s.amount_share != null || s.crowding_pct != null) ?? null

  return {
    board,
    days,
    hot_top_n: hotTopN,
    start_date: withShare[0]?.date ?? series[0]?.date ?? null,
    end_date: withShare[withShare.length - 1]?.date ?? series[series.length - 1]?.date ?? null,
    latest: {
      trade_date: latestPoint?.date ?? null,
      amount_share: latestPoint?.amount_share ?? null,
      crowding_pct: latestPoint?.crowding_pct ?? null,
      amount: latestPoint?.amount ?? null,
      total_amount: latestPoint?.total_amount ?? null,
      change_pct: latestPoint?.change_pct ?? null,
      is_hot: latestPoint?.is_hot ?? false,
    },
    series,
    boards: SECTOR_CROWDING_BOARDS,
    backfilled,
    note,
  }
}
