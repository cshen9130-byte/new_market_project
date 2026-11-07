import {
  childStrategies,
  decideYingmiRun,
  level1Strategies,
  metricKey,
  nextYingmiSearch,
  shanghaiParts,
  strategyKey,
  YINGMI_RETURN_SLICES,
  type YingmiNodeProgress,
  type YingmiSearchRequest,
  type YingmiTreeNode,
} from "@/lib/ma/yingmi-private-fund"
import { callYingmiTool, refreshYingmiAccess, searchArguments, YingmiQuotaError } from "@/lib/server/yingmi-mcp"
import {
  companyNamesForStrategy,
  countYingmiStrategy,
  progressOrEmpty,
  readYingmiCredential,
  readYingmiSync,
  saveYingmiCredential,
  upsertYingmiFunds,
  withYingmiLock,
  writeYingmiSync,
  type YingmiIncomingFund,
  type YingmiSyncState,
} from "@/lib/server/yingmi-private-fund-store"

const CALL_BUDGET = Number(process.env.YINGMI_MCP_CALL_BUDGET || 80)

export type YingmiEtlResult = {
  action: string
  reason: string
  calls: number
  status: string
}

export async function runYingmiPrivateFundEtl(opts?: { force?: boolean }): Promise<YingmiEtlResult> {
  const locked = await withYingmiLock(() => runLocked(opts?.force === true))
  if (locked && typeof locked === "object" && "skipped" in locked) {
    return { action: "skip", reason: "已有一次拉取在进行", calls: 0, status: "running" }
  }
  return locked as YingmiEtlResult
}

async function runLocked(force: boolean): Promise<YingmiEtlResult> {
  const { date, weekday } = shanghaiParts()
  const current = await readYingmiSync()
  const decision = decideYingmiRun({
    today: date,
    weekday,
    status: current.status,
    runStartedOn: current.state.runStartedOn,
    finishedOn: current.state.finishedOn,
    callsDay: current.state.callsDay,
    force,
  })
  if (decision.action === "skip") {
    return { action: "skip", reason: decision.reason, calls: 0, status: current.status }
  }

  const credential = await readYingmiCredential()
  if (!credential) {
    await writeYingmiSync("error", current.state, "尚未连接盈米账号")
    return { action: "skip", reason: "尚未连接盈米账号", calls: 0, status: "error" }
  }

  const state = decision.action === "fresh" ? freshState(date, current.state.callsDay, current.state.callsToday) : current.state
  if (state.callsDay !== date) {
    state.callsDay = date
    state.callsToday = 0
  }
  let calls = 0
  await writeYingmiSync("running", state, null)

  try {
    const token = await refreshYingmiAccess({ clientId: credential.clientId, refreshToken: credential.refreshToken })
    if (token.refreshToken) await saveYingmiCredential(credential.clientId, token.refreshToken)
    const access = token.accessToken

    if (!state.tree) {
      const body = await callYingmiTool(access, "GetPrivateFundStrategyTree", {})
      calls += 1
      state.callsToday += 1
      state.tree = readTree(body)
      state.strategies = level1Strategies(state.tree)
      for (const strategy of state.strategies) {
        const key = strategyKey(strategy)
        if (!state.progress[key]) state.progress[key] = progressOrEmpty(state.progress, key)
      }
      await writeYingmiSync("running", state, null)
    }

    while (state.callsToday < CALL_BUDGET) {
      await fillCompanies(state)
      const request = nextYingmiSearch(state.strategies, state.progress)
      if (!request) {
        state.finishedOn = date
        await writeYingmiSync("complete", state, null)
        return { action: decision.action, reason: "策略节点已经拉完", calls, status: "complete" }
      }
      const body = await callYingmiTool(access, "GetPrivateFundSearch", searchArguments(request))
      calls += 1
      state.callsToday += 1
      await applySearch(state, request, body)
      await writeYingmiSync("running", state, null)
    }

    await writeYingmiSync("paused_quota", state, `本次已用 ${CALL_BUDGET} 次，留到下一次继续`)
    return { action: decision.action, reason: "达到本次调用上限，下次继续", calls, status: "paused_quota" }
  } catch (err) {
    if (err instanceof YingmiQuotaError) {
      state.callsDay = date
      await writeYingmiSync("paused_quota", state, err.message)
      return { action: decision.action, reason: err.message, calls, status: "paused_quota" }
    }
    const message = err instanceof Error ? err.message : String(err)
    await writeYingmiSync("error", state, message)
    return { action: decision.action, reason: message, calls, status: "error" }
  }
}

function freshState(today: string, callsDay: string | null, callsToday: number): YingmiSyncState {
  return {
    runStartedOn: today,
    finishedOn: null,
    callsDay,
    callsToday,
    strategies: [],
    progress: {},
    tree: null,
  }
}

function readTree(body: unknown): YingmiTreeNode[] {
  const record = asRecord(body)
  const data = asRecord(record.data)
  const tree = data.tree || record.tree
  if (!Array.isArray(tree)) throw new Error("策略树为空")
  return tree as YingmiTreeNode[]
}

async function applySearch(state: YingmiSyncState, request: YingmiSearchRequest, body: unknown): Promise<void> {
  const record = asRecord(body)
  const data = asRecord(record.data)
  const items = (Array.isArray(data.items) ? data.items : Array.isArray(record.items) ? record.items : []) as unknown[]
  const funds = items.map(readFund).filter((item): item is YingmiIncomingFund => item != null)
  if (funds.length) await upsertYingmiFunds(funds)

  const key = strategyKey(request.strategy)
  const node = progressOrEmpty(state.progress, key)
  const total = numberOrNull(data.totalMatched ?? record.totalMatched)
  if (total != null) node.total = total
  node.truncated = Boolean(data.truncated ?? record.truncated)
  if (request.metrics) {
    const keyOfSlice = metricKey(request.metrics)
    if (!node.metricsTried.includes(keyOfSlice)) node.metricsTried.push(keyOfSlice)
  } else if (request.companyName) {
    if (!node.companiesTried.includes(request.companyName)) node.companiesTried.push(request.companyName)
  } else {
    node.unfilteredDone = true
  }
  node.collected = await countYingmiStrategy(request.strategy)
  state.progress[key] = node

  if (node.truncated && state.tree && node.total != null && node.collected < node.total) {
    for (const child of childStrategies(state.tree, request.strategy)) {
      const childKey = strategyKey(child)
      if (state.strategies.some((item) => strategyKey(item) === childKey)) continue
      state.strategies.push(child)
      state.progress[childKey] = progressOrEmpty(state.progress, childKey)
    }
  }
}

async function fillCompanies(state: YingmiSyncState): Promise<void> {
  for (const strategy of state.strategies) {
    const key = strategyKey(strategy)
    const node = state.progress[key]
    if (!node?.truncated || node.companies.length) continue
    if (node.total != null && node.collected >= node.total) continue
    if (node.metricsTried.length < YINGMI_RETURN_SLICES.length) continue
    node.companies = await companyNamesForStrategy(strategy)
  }
}

function readFund(value: unknown): YingmiIncomingFund | null {
  const row = asRecord(value)
  const fundCode = stringOrNull(row.fundCode)
  const fundName = stringOrNull(row.fundName)
  if (!fundCode || !fundName) return null
  return {
    fundCode,
    fundName,
    companyName: stringOrNull(row.companyName),
    strategyLevel1: stringOrNull(row.strategyLevel1),
    strategyLevel2: stringOrNull(row.strategyLevel2),
    strategyLevel3: stringOrNull(row.strategyLevel3),
    setupDate: stringOrNull(row.setupDate),
    navDate: stringOrNull(row.navDate),
    navUnit: numberOrNull(row.navUnit),
    return1y: numberOrNull(row.return1y),
    maxDrawdown1y: numberOrNull(row.maxDrawdown1y),
    performanceHideReason: stringOrNull(row.performanceHideReason),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}
