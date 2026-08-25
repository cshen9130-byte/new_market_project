"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ContractTenor } from "@/lib/all-weather/setup"
import { isSleeveKey, SLEEVE_KEYS, type SleeveKey } from "@/lib/all-weather/universe"
import { fetchAllWeatherOverview, saveAllWeatherSetup, type AllWeatherBookMeta } from "@/lib/client/all-weather-paper"
import type { CtpCandle, CtpTick } from "@/lib/client/ctp-market"
import { isLiveSessionFor, mergeClosedMarks } from "@/lib/client/market-hours"
import {
  ALL_WEATHER_PORTFOLIO_ID,
  allWeatherHoldingsKey,
  applyAllWeatherBook,
  attachAllWeatherSlice,
  closePosition,
  DEFAULT_PAPER_CAPITAL,
  emptyPaperState,
  evaluatePaperTrading,
  hydratePaperState,
  isAllWeatherAccount,
  loadPaperState,
  markPrice,
  mergePaperStates,
  nid,
  openPosition,
  paperNav,
  paperReturn,
  paperSliceHasUserData,
  positionMargin,
  positionPnl,
  savePaperState,
  splitPaperState,
  unionPaperSlice,
  type PaperAccountKind,
  type PaperScope,
  type PaperSide,
  type PaperState,
  type PaperStrategyDraft,
} from "@/lib/client/paper-trading"
import { fetchPaperTradingSlices, savePaperTradingSlice } from "@/lib/client/paper-trading-sync"

export type AwOrderConfirm = {
  action: string
  run: () => void
}

export function usePaperTrading(quotes: Record<string, CtpTick>, candles: Record<string, CtpCandle[]>) {
  const [state, setState] = useState<PaperState>(() => hydratePaperState(emptyPaperState()))
  const [ready, setReady] = useState(false)
  const [selectedPortfolioId, setSelectedPortfolioId] = useState("default")
  const [error, setError] = useState<string | null>(null)
  const [extraMarks, setExtraMarks] = useState<Record<string, number>>({})
  const [awMeta, setAwMeta] = useState<AllWeatherBookMeta | null>(null)
  const [awLoading, setAwLoading] = useState(false)
  const [awConfirm, setAwConfirm] = useState<AwOrderConfirm | null>(null)
  const prevMarks = useRef<Record<string, number>>({})
  const skipSave = useRef(true)
  const hydrated = useRef(false)
  const lastSaved = useRef({ team: "", mine: "" })
  const saveTimer = useRef<number | null>(null)
  const stateRef = useRef(state)
  const pendingSlices = useRef<{ team: PaperState; mine: PaperState; teamJson: string; mineJson: string } | null>(null)
  stateRef.current = state

  useEffect(() => {
    let cancelled = false
    const loaded = loadPaperState()
    setState(hydratePaperState(loaded))
    setSelectedPortfolioId(loaded.portfolios[0]?.id || "default")
    setReady(true)

    void fetchPaperTradingSlices()
      .then((remote) => {
        if (cancelled) return
        const prev = stateRef.current
        const localSlices = splitPaperState(prev)
        const mine = paperSliceHasUserData(remote.mine)
          ? unionPaperSlice(remote.mine, localSlices.mine)
          : localSlices.mine
        const team = paperSliceHasUserData(remote.team)
          ? unionPaperSlice(remote.team, localSlices.team)
          : localSlices.team
        const merged = attachAllWeatherSlice(mergePaperStates(team, mine), prev)
        const mergedSlices = splitPaperState(merged)
        const teamJson = JSON.stringify(mergedSlices.team)
        const mineJson = JSON.stringify(mergedSlices.mine)
        lastSaved.current = { team: teamJson, mine: mineJson }
        setState(merged)
        setSelectedPortfolioId((cur) =>
          merged.portfolios.some((p) => p.id === cur) ? cur : merged.portfolios[0]?.id || "default",
        )
        if (remote.userId) {
          if (mineJson !== JSON.stringify(remote.mine)) {
            void savePaperTradingSlice("mine", mergedSlices.mine).catch(() => {})
          }
          if (teamJson !== JSON.stringify(remote.team)) {
            void savePaperTradingSlice(
              "team",
              mergedSlices.team,
              mergedSlices.team.portfolios.map((p) => p.id),
            ).catch(() => {})
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) hydrated.current = true
      })

    const poll = window.setInterval(() => {
      if (!hydrated.current) return
      void fetchPaperTradingSlices()
        .then((remote) => {
          if (cancelled) return
          setState((prev) => {
            const local = splitPaperState(prev)
            const remoteTeamJson = JSON.stringify(remote.team)
            const localTeamJson = JSON.stringify(local.team)
            if (remoteTeamJson === lastSaved.current.team || remoteTeamJson === localTeamJson) return prev
            if (localTeamJson !== lastSaved.current.team) return prev
            lastSaved.current.team = remoteTeamJson
            return attachAllWeatherSlice(mergePaperStates(remote.team, local.mine), prev)
          })
        })
        .catch(() => {})
    }, 45_000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      const pending = pendingSlices.current
      if (pending) {
        if (pending.teamJson !== lastSaved.current.team) {
          void savePaperTradingSlice(
            "team",
            pending.team,
            pending.team.portfolios.map((p) => p.id),
          ).catch(() => {})
        }
        if (pending.mineJson !== lastSaved.current.mine) {
          void savePaperTradingSlice("mine", pending.mine).catch(() => {})
        }
      }
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    savePaperState(state)
    if (!hydrated.current) return
    const slices = splitPaperState(state)
    const teamJson = JSON.stringify(slices.team)
    const mineJson = JSON.stringify(slices.mine)
    pendingSlices.current = { team: slices.team, mine: slices.mine, teamJson, mineJson }
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const pending = pendingSlices.current
      if (!pending) return
      if (pending.teamJson !== lastSaved.current.team) {
        lastSaved.current.team = pending.teamJson
        void savePaperTradingSlice(
          "team",
          pending.team,
          pending.team.portfolios.map((p) => p.id),
        ).catch(() => {})
      }
      if (pending.mineJson !== lastSaved.current.mine) {
        lastSaved.current.mine = pending.mineJson
        void savePaperTradingSlice("mine", pending.mine).catch(() => {})
      }
    }, 800)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [ready, state])

  useEffect(() => {
    if (!ready) return
    setState((prev) => evaluatePaperTrading(prev, quotes, candles, prevMarks.current, extraMarks))
    const nextMarks = { ...prevMarks.current }
    for (const [symbol, tick] of Object.entries(quotes)) {
      if (tick.last != null && isLiveSessionFor(symbol)) nextMarks[symbol] = tick.last
    }
    for (const [symbol, px] of Object.entries(extraMarks)) {
      if (px > 0) nextMarks[symbol] = px
    }
    prevMarks.current = nextMarks
  }, [ready, quotes, candles, extraMarks])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const pull = () =>
      fetchAllWeatherOverview(false)
        .then(({ holdings, marks, meta }) => {
          if (cancelled) return
          setExtraMarks((prev) => mergeClosedMarks(prev, marks))
          setAwMeta(meta)
          setState((prev) => {
            if (!prev.portfolios.some((p) => p.id === ALL_WEATHER_PORTFOLIO_ID)) return prev
            const nextKey = allWeatherHoldingsKey(holdings)
            const curKey = allWeatherHoldingsKey(
              prev.positions.filter((p) => p.portfolioId === ALL_WEATHER_PORTFOLIO_ID && p.status === "open"),
            )
            if (nextKey === curKey) return prev
            return applyAllWeatherBook(prev, holdings, Date.now(), marks, meta.initialCapital)
          })
        })
        .catch(() => {})
    void pull()
    const timer = window.setInterval(() => void pull(), 45_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [ready])

  const selectedPortfolio = state.portfolios.find((p) => p.id === selectedPortfolioId) || state.portfolios[0] || null

  const dismissAwConfirm = useCallback(() => setAwConfirm(null), [])

  const confirmAwAction = useCallback(() => {
    const pending = awConfirm
    setAwConfirm(null)
    pending?.run()
  }, [awConfirm])

  const guardAwOrder = useCallback((portfolioId: string, action: string, run: () => void) => {
    if (!isAllWeatherAccount(portfolioId)) {
      run()
      return
    }
    setAwConfirm({ action, run })
  }, [])

  const createPortfolio = useCallback(
    (
      name: string,
      kind: Exclude<PaperAccountKind, "all-weather"> = "manual",
      initialCapital = DEFAULT_PAPER_CAPITAL,
      scope: PaperScope = "mine",
    ) => {
      const capital = Number(initialCapital)
      if (!Number.isFinite(capital) || capital <= 0) {
        setError("总资金必须大于 0")
        return null
      }
      const id = nid("pf-")
      const resolvedScope: PaperScope = scope === "team" ? "team" : "mine"
      setState((prev) => {
        const trimmed = name.trim()
        const count = prev.portfolios.filter((p) => (p.kind || "manual") === kind && (p.scope || "mine") === resolvedScope).length + 1
        const resolved =
          trimmed ||
          (resolvedScope === "team"
            ? kind === "strategy"
              ? `团队策略 ${count}`
              : `团队账户 ${count}`
            : kind === "strategy"
              ? `策略账户 ${count}`
              : `手动账户 ${count}`)
        return {
          ...prev,
          portfolios: [
            ...prev.portfolios,
            { id, name: resolved, kind, scope: resolvedScope, createdAt: Date.now(), initialCapital: capital },
          ],
        }
      })
      setSelectedPortfolioId(id)
      setError(null)
      return id
    },
    [],
  )

  const deletePortfolio = useCallback((id: string) => {
    if (id === ALL_WEATHER_PORTFOLIO_ID) {
      setError("全天候账户由策略自动执行，不能删除")
      return
    }
    setState((prev) => {
      if (prev.portfolios.length <= 1) return prev
      const portfolios = prev.portfolios.filter((p) => p.id !== id)
      return {
        portfolios,
        products: prev.products.filter((p) => p.portfolioId !== id),
        positions: prev.positions.filter((p) => p.portfolioId !== id),
        strategies: prev.strategies.filter((s) => s.portfolioId !== id),
      }
    })
    setSelectedPortfolioId((cur) => (cur === id ? "" : cur))
  }, [])

  const addProduct = useCallback((portfolioId: string, symbol: string) => {
    setState((prev) => {
      if (prev.products.some((p) => p.portfolioId === portfolioId && p.symbol === symbol)) return prev
      return { ...prev, products: [...prev.products, { id: nid("prd-"), portfolioId, symbol }] }
    })
    setError(null)
  }, [])

  const removeProduct = useCallback((productId: string) => {
    setState((prev) => ({
      ...prev,
      products: prev.products.filter((p) => p.id !== productId),
    }))
  }, [])

  const openManual = useCallback(
    (portfolioId: string, symbol: string, side: PaperSide, lots: number, entryPrice: number) => {
      let err: string | null = null
      const execute = () => {
        setState((prev) => {
          const opened = openPosition(prev, { portfolioId, symbol, side, lots, entryPrice, source: "manual" })
          err = opened.error
          return opened.state
        })
        setError(err)
      }
      guardAwOrder(portfolioId, "开仓", execute)
      return err
    },
    [guardAwOrder],
  )

  const flatten = useCallback(
    (positionId: string) => {
      const pos = state.positions.find((p) => p.id === positionId)
      if (!pos) return
      const execute = () => {
        const current = state.positions.find((p) => p.id === positionId)
        const mark = markPrice(current?.symbol || pos.symbol, quotes, candles, extraMarks)
        if (mark == null) {
          setError("暂无行情，无法平仓")
          return
        }
        setState((prev) => closePosition(prev, positionId, mark, "手动平仓"))
        setError(null)
      }
      guardAwOrder(pos.portfolioId, "平仓", execute)
    },
    [state.positions, quotes, candles, extraMarks, guardAwOrder],
  )

  const flattenAll = useCallback(() => {
    const portfolioId = selectedPortfolio?.id || ""
    const hasOpen = state.positions.some(
      (p) => p.status === "open" && (!selectedPortfolio || p.portfolioId === selectedPortfolio.id),
    )
    if (!hasOpen) return
    const execute = () => {
      setState((prev) => {
        let next = prev
        for (const pos of prev.positions) {
          if (pos.status !== "open") continue
          if (selectedPortfolio && pos.portfolioId !== selectedPortfolio.id) continue
          const mark = markPrice(pos.symbol, quotes, candles, extraMarks)
          if (mark == null) continue
          next = closePosition(next, pos.id, mark, "一键全平")
        }
        return next
      })
      setError(null)
    }
    guardAwOrder(portfolioId, "全平", execute)
  }, [selectedPortfolio, state.positions, quotes, candles, extraMarks, guardAwOrder])

  const loadAllWeather = useCallback(async (refresh = true) => {
    setAwLoading(true)
    try {
      const { holdings, marks, meta } = await fetchAllWeatherOverview(refresh)
      if (!holdings.length) {
        setError("全天候策略暂无持仓")
        return null
      }
      setState((prev) => applyAllWeatherBook(prev, holdings, Date.now(), marks, meta.initialCapital))
      setSelectedPortfolioId(ALL_WEATHER_PORTFOLIO_ID)
      setExtraMarks(marks)
      setAwMeta(meta)
      setError(null)
      const focus =
        holdings.find((h) => h.asset === "IF") ||
        holdings.find((h) => h.asset === "IC") ||
        holdings.find((h) => h.asset === "IM") ||
        holdings[0]
      return focus.contract
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载全天候失败")
      return null
    } finally {
      setAwLoading(false)
    }
  }, [])

  const setContractTenor = useCallback(async (tenor: ContractTenor) => {
    setAwLoading(true)
    try {
      const { holdings, marks, meta } = await saveAllWeatherSetup(tenor)
      if (!holdings.length) {
        setError("全天候策略暂无持仓")
        return null
      }
      setState((prev) => applyAllWeatherBook(prev, holdings, Date.now(), marks, meta.initialCapital))
      setSelectedPortfolioId(ALL_WEATHER_PORTFOLIO_ID)
      setExtraMarks(marks)
      setAwMeta(meta)
      setError(null)
      const focus =
        holdings.find((h) => h.asset === "IF") ||
        holdings.find((h) => h.asset === "IC") ||
        holdings.find((h) => h.asset === "IM") ||
        holdings[0]
      return focus.contract
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换合约失败")
      return null
    } finally {
      setAwLoading(false)
    }
  }, [])

  const createAndArmStrategy = useCallback(
    (draft: PaperStrategyDraft) => {
      const name = draft.name.trim() || `${draft.symbol} ${draft.side === "long" ? "多" : "空"}`
      if (draft.lots <= 0) {
        setError("手数必须大于 0")
        return null
      }
      if (draft.entryMode === "breakout" && (draft.entryLevel == null || draft.entryLevel <= 0)) {
        setError("请填写突破价格")
        return null
      }
      const fast = draft.maFast ?? 5
      const slow = draft.maSlow ?? 20
      if (draft.entryMode === "ma_cross" && fast >= slow) {
        setError("快线周期需小于慢线")
        return null
      }

      const id = nid("stg-")
      const mark = markPrice(draft.symbol, quotes, candles, extraMarks)
      let err: string | null = null
      const execute = () => {
        setState((prev) => {
          let next: PaperState = {
            ...prev,
            strategies: [
              ...prev.strategies,
              {
                id,
                portfolioId: draft.portfolioId,
                name,
                symbol: draft.symbol,
                side: draft.side,
                lots: draft.lots,
                entryMode: draft.entryMode,
                entryLevel: draft.entryLevel,
                entryCompare: draft.entryCompare ?? "above",
                maFast: fast,
                maSlow: slow,
                stopLossPts: draft.stopLossPts || null,
                takeProfitPts: draft.takeProfitPts || null,
                status: draft.entryMode === "market" ? "filled" : "armed",
                createdAt: Date.now(),
                lastNote: draft.entryMode === "market" ? "市价开仓" : "等待入场",
              },
            ],
          }
          if (draft.entryMode === "market") {
            if (mark == null) {
              err = "暂无行情，无法市价开仓"
              return prev
            }
            const opened = openPosition(next, {
              portfolioId: draft.portfolioId,
              symbol: draft.symbol,
              side: draft.side,
              lots: draft.lots,
              entryPrice: mark,
              strategyId: id,
              source: "strategy",
            })
            if (opened.error || !opened.position) {
              err = opened.error
              return prev
            }
            next = {
              ...opened.state,
              strategies: opened.state.strategies.map((s) =>
                s.id === id ? { ...s, positionId: opened.position!.id, filledAt: Date.now() } : s,
              ),
            }
          }
          return next
        })
        setError(err)
      }
      guardAwOrder(draft.portfolioId, draft.entryMode === "market" ? "开仓" : "启动策略", execute)
      return err ? null : id
    },
    [quotes, candles, extraMarks, guardAwOrder],
  )

  const disableStrategy = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      strategies: prev.strategies.map((s) => (s.id === id && s.status === "armed" ? { ...s, status: "disabled" } : s)),
    }))
  }, [])

  const deleteStrategy = useCallback((id: string) => {
    setState((prev) => ({ ...prev, strategies: prev.strategies.filter((s) => s.id !== id) }))
  }, [])

  const rows = useMemo(() => {
    const portfolioId = selectedPortfolio?.id
    if (!portfolioId) return []
    return state.products
      .filter((p) => p.portfolioId === portfolioId)
      .map((product) => {
        const position = state.positions.find((pos) => pos.productId === product.id && pos.status === "open") || null
        const mark = markPrice(product.symbol, quotes, candles, extraMarks)
        const quote = quotes[product.symbol] || quotes[product.symbol.toUpperCase()]
        const base = quote?.pre_settlement || quote?.pre_close || extraMarks[product.symbol] || null
        const prev = position?.entryPrice ?? null
        const diff = mark != null && (quote?.pre_settlement || quote?.pre_close) != null
          ? mark - (quote!.pre_settlement || quote!.pre_close || 0)
          : mark != null && prev != null
            ? mark - prev
            : null
        const pct = diff != null && (quote?.pre_settlement || quote?.pre_close || prev)
          ? (diff / (quote?.pre_settlement || quote?.pre_close || prev || 1)) * 100
          : null
        return {
          product,
          position,
          mark,
          diff,
          pct,
          pnl: position ? positionPnl(position, mark) : null,
          margin: position ? positionMargin(position, mark) : null,
        }
      })
  }, [selectedPortfolio?.id, state.products, state.positions, quotes, candles, extraMarks])

  const openPositions = useMemo(
    () =>
      state.positions
        .filter((p) => p.status === "open" && (!selectedPortfolio || p.portfolioId === selectedPortfolio.id))
        .map((position) => {
          const mark = markPrice(position.symbol, quotes, candles, extraMarks)
          return {
            position,
            mark,
            pnl: positionPnl(position, mark),
            margin: positionMargin(position, mark),
            strategy: state.strategies.find((s) => s.id === position.strategyId) || null,
          }
        }),
    [state.positions, state.strategies, quotes, candles, extraMarks, selectedPortfolio],
  )

  const summary = useMemo(() => {
    let unrealized = 0
    let realized = 0
    let marginOccupied = 0
    for (const pos of state.positions) {
      if (selectedPortfolio && pos.portfolioId !== selectedPortfolio.id) continue
      const mark = markPrice(pos.symbol, quotes, candles, extraMarks)
      const pnl = positionPnl(pos, mark)
      if (pnl != null) {
        if (pos.status === "open") unrealized += pnl
        else realized += pnl
      }
      if (pos.status === "open") {
        const margin = positionMargin(pos, mark)
        if (margin != null) marginOccupied += margin
      }
    }
    const initialCapital =
      selectedPortfolio?.id === ALL_WEATHER_PORTFOLIO_ID
        ? awMeta?.initialCapital || selectedPortfolio.initialCapital || DEFAULT_PAPER_CAPITAL
        : selectedPortfolio?.initialCapital || DEFAULT_PAPER_CAPITAL
    return {
      unrealized,
      realized,
      total: unrealized + realized,
      marginOccupied,
      initialCapital,
      nav: paperNav(initialCapital, realized, unrealized),
      ret: paperReturn(initialCapital, realized, unrealized),
      openCount: openPositions.length,
      productCount: selectedPortfolio ? state.products.filter((p) => p.portfolioId === selectedPortfolio.id).length : 0,
    }
  }, [state.positions, state.products, quotes, candles, extraMarks, openPositions.length, selectedPortfolio, awMeta?.initialCapital])

  const sleevePnl = useMemo(() => {
    const out = Object.fromEntries(SLEEVE_KEYS.map((key) => [key, { unrealized: 0, realized: 0, live: 0 }])) as Record<
      SleeveKey,
      { unrealized: number; realized: number; live: number }
    >
    for (const pos of state.positions) {
      if (selectedPortfolio && pos.portfolioId !== selectedPortfolio.id) continue
      if (!pos.sleeve || !isSleeveKey(pos.sleeve)) continue
      const mark = markPrice(pos.symbol, quotes, candles, extraMarks)
      const pnl = positionPnl(pos, mark)
      if (pnl == null) continue
      if (pos.status === "open") out[pos.sleeve].unrealized += pnl
      else out[pos.sleeve].realized += pnl
      out[pos.sleeve].live = out[pos.sleeve].unrealized + out[pos.sleeve].realized
    }
    return out
  }, [state.positions, quotes, candles, extraMarks, selectedPortfolio])

  return {
    ready,
    state,
    error,
    setError,
    selectedPortfolio,
    selectedPortfolioId: selectedPortfolio?.id || "",
    setSelectedPortfolioId,
    createPortfolio,
    deletePortfolio,
    addProduct,
    removeProduct,
    openManual,
    flatten,
    flattenAll,
    loadAllWeather,
    setContractTenor,
    awMeta,
    awLoading,
    extraMarks,
    createAndArmStrategy,
    disableStrategy,
    deleteStrategy,
    awConfirm,
    confirmAwAction,
    dismissAwConfirm,
    rows,
    openPositions,
    summary,
    sleevePnl,
  }
}

export type PaperTradingApi = ReturnType<typeof usePaperTrading>
