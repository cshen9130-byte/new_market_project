import { NextResponse } from "next/server"
import {
  buildCompareReport,
  distinctFundFamilies,
  groupByTeamStrategy,
  incompleteWindows,
  missReport,
  passageNamesFund,
  teamStrategyLabel,
  type CompareBinding,
  type CompareFund,
  type CompareNote,
} from "@/lib/server/compare-funds"
import { loadCompareFundRecord, lookupFundQueryHits } from "@/lib/server/fund-data-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const STEP_TITLES = [
  "",
  "搜索并匹配基金/管理人信息",
  "获取净值历史数据",
  "获取管理人背景信息",
  "查询知识库相关文档",
  "生成对比分析报告",
]

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.warn(`[ai-researcher] ${label} timed out after ${ms}ms, using fallback`)
        resolve(fallback)
      }, ms)
    }),
  ])
}

function encodeEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

async function notesForFunds(
  funds: CompareFund[],
  queries: Map<string, string>,
  kbPath: string,
): Promise<CompareNote[]> {
  const { searchKnowledgeBase } = await import("@/lib/server/knowledge-chat")
  const notes: CompareNote[] = []
  for (const fund of funds) {
    const query = queries.get(fund.register_number) || fund.fund_name
    const found = await withTimeout(
      searchKnowledgeBase({
        question: `${fund.fund_name} ${fund.register_number}`,
        folderPath: kbPath || null,
        limit: 6,
      }),
      12_000,
      { anchors: [] as string[], hits: [] },
      `compare-notes:${fund.register_number}`,
    )
    for (const hit of found.hits) {
      const text = `${hit.snippet}\n${hit.path}`
      if (!passageNamesFund(text, [fund.fund_name, query], fund.register_number)) continue
      notes.push({
        register_number: fund.register_number,
        path: hit.path,
        page: hit.page,
        quote: hit.snippet.replace(/\s+/g, " ").trim().slice(0, 400),
      })
      if (notes.filter((note) => note.register_number === fund.register_number).length >= 2) break
    }
  }
  return notes
}

export async function POST(req: Request) {
  let body: { subjects?: string[]; kbPath?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const subjects = Array.isArray(body.subjects)
    ? body.subjects.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
    : []
  if (subjects.length === 0) {
    return NextResponse.json({ error: "请提供至少一个分析对象" }, { status: 400 })
  }
  const kbPath = body.kbPath?.trim() ?? ""

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        try {
          controller.enqueue(encodeEvent(data))
        } catch {
          // controller already closed
        }
      }
      const step = (n: number, summary: string) => {
        emit({ type: "step_start", step: n, title: STEP_TITLES[n] })
        emit({ type: "step_done", step: n, summary })
      }

      try {
        const misses: Array<{ query: string; reason: string }> = []
        const bindings: CompareBinding[] = []
        const funds: CompareFund[] = []
        const queryByCode = new Map<string, string>()

        for (const subject of subjects) {
          const hits = await lookupFundQueryHits(subject)
          const families = distinctFundFamilies(hits.map((hit) => hit.registerNumber))
          if (hits.length === 0) {
            misses.push({ query: subject, reason: "数据库中未找到匹配基金" })
            continue
          }
          if (families.length > 1) {
            misses.push({ query: subject, reason: "名称对应多只基金，请改用备案号" })
            continue
          }
          const hit = hits[0]
          const record = await loadCompareFundRecord(hit.registerNumber)
          if (!record) {
            misses.push({ query: subject, reason: "数据库中未找到匹配基金" })
            continue
          }
          const strategy = teamStrategyLabel(record.strategy_l1, record.strategy_l2, record.strategy_l3)
          const fund: CompareFund = {
            register_number: record.register_number,
            fund_name: record.fund_name,
            manager: record.manager,
            strategy,
            strategy_l1: record.strategy_l1,
            strategy_l2: record.strategy_l2,
            strategy_l3: record.strategy_l3,
            inception_date: record.inception_date,
            latest_nav: record.latest_nav,
            latest_nav_date: record.latest_nav_date,
            share_class: hit.shareClass,
            nav_scope: hit.navScope,
            metrics: {
              ret_1w: record.ret_1w,
              ret_1m: record.ret_1m,
              ret_3m: record.ret_3m,
              ret_6m: record.ret_6m,
              ret_1y: record.ret_1y,
              sharpe_1y: record.sharpe_1y,
              calmar_1y: record.calmar_1y,
            },
            incomplete_windows: incompleteWindows(record.inception_date, record.latest_nav_date),
          }
          funds.push(fund)
          queryByCode.set(fund.register_number, subject)
          bindings.push({
            query: subject,
            register_number: fund.register_number,
            fund_name: fund.fund_name,
            match: hit.match,
            match_score: hit.matchScore,
            share_class: hit.shareClass,
            nav_loaded: fund.latest_nav != null,
            nav_scope: hit.navScope,
          })
        }

        const resolved = misses.length === 0
        emit({ type: "resolution", resolved, misses, bindings })

        const plan = resolved
          ? `已绑定 ${bindings.map((b) => `${b.query} → ${b.fund_name}（${b.register_number}）`).join("；")}。业绩取数据库原值。团队策略不同则只分组，不排序。`
          : `有对象未绑定，不生成对比报告。未命中：${misses.map((m) => m.query).join("、")}。`
        emit({ type: "phase", phase: "planning", message: "正在核对数据库记录..." })
        emit({ type: "plan_text", content: plan })
        emit({ type: "plan_done" })

        if (!resolved) {
          step(1, `未找到：${misses.map((m) => m.query).join("、")}`)
          step(2, "已跳过。有对象未绑定，不读取净值。")
          step(3, "已跳过。有对象未绑定，不补管理人。")
          step(4, "已跳过。未绑定的对象不用投资笔记补业绩。")
          step(5, "未生成对比报告。")
          const text = missReport(misses)
          emit({ type: "report_text", delta: text })
          emit({
            type: "compare",
            resolved: false,
            misses,
            bindings,
            same_strategy: false,
            strategy_groups: [],
            funds: [],
            notes: [],
            report: null,
          })
          emit({ type: "done" })
          return
        }

        const grouped = groupByTeamStrategy(funds)
        step(
          1,
          bindings.map((b) => `${b.query} → ${b.fund_name}（${b.register_number}，${b.match}）`).join("；"),
        )
        step(
          2,
          funds
            .map((f) => `${f.fund_name} ${f.latest_nav ?? "无净值"}${f.latest_nav_date ? `（${f.latest_nav_date}）` : ""}`)
            .join("；"),
        )
        step(3, funds.map((f) => `${f.fund_name}：${f.manager || "管理人未填写"}`).join("；"))

        let notes: CompareNote[] = []
        try {
          notes = await notesForFunds(funds, queryByCode, kbPath)
          step(
            4,
            notes.length > 0
              ? `投资笔记中有 ${notes.length} 段点名这些基金的原文`
              : "投资笔记中没有点名这些基金的段落，已省略笔记",
          )
        } catch (err) {
          step(4, `投资笔记查询出错：${(err as Error).message}。已省略笔记，业绩仍以数据库为准。`)
        }

        const report = buildCompareReport({
          same_strategy: grouped.same_strategy,
          groups: grouped.groups,
          bindings,
          funds,
          notes,
        })
        step(5, grouped.same_strategy ? "已输出数据库指标。未另写配置建议。" : "团队策略不同，已分组，未做同策略排序。")
        emit({ type: "report_text", delta: report })
        emit({
          type: "compare",
          resolved: true,
          misses: [],
          bindings,
          same_strategy: grouped.same_strategy,
          strategy_groups: grouped.groups,
          funds,
          notes,
          report,
        })
        emit({ type: "done" })
      } catch (err) {
        console.error("[ai-researcher/compare-analysis]", err)
        emit({ type: "error", message: `对比失败：${(err as Error).message}` })
      } finally {
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
