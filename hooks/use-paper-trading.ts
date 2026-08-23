"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ContractTenor } from "@/lib/all-weather/setup"
import { fetchAllWeatherOverview, saveAllWeatherSetup, type AllWeatherBookMeta } from "@/lib/client/all-weather-paper"
import type { CtpCandle, CtpTick } from "@/lib/client/ctp-market"
import {
  ALL_WEATHER_PORTFOLIO_ID,
  applyAllWeatherBook,
  closePosition,
  emptyPaperState,
  evaluatePaperTrading,
  loadPaperState,
  markPrice,
  nid,
  openPosition,
  positionPnl,
  savePaperState,
  type PaperSide,
  type PaperState,
  type PaperStrategyDraft,
} from "@/lib/client/paper-trading"

export function usePaperTrading(quotes: Record<string, CtpTick>, candles: Record<string, CtpCandle[]>) {
  const [state, setState] = useState<PaperState>(emptyPaperState)
  const [ready, setReady] = useState(false)
  const [selectedPortfolioId, setSelectedPortfolioId] = useState("default")
  const [error, setError] = useState<string | null>(null)
  const [extraMarks, setExtraMarks] = useState<Record<string, number>>({})
  const [awMeta, setAwMeta] = useState<AllWeatherBookMeta | null>(null)
  const [awLoading, setAwLoading] = useState(false)
  const prevMarks = useRef<Record<string, number>>({})
  const skipSave = useRef(true)

  useEffect(() => {
    const loaded = loadPaperState()
    setState(loaded)
    setSelectedPortfolioId(loaded.portfolios[0]?.id || "default")
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    savePaperState(state)
  }, [ready, state])

  useEffect(() => {
    if (!ready) return
    setState((prev) => evaluatePaperTrading(prev, quotes, candles, prevMarks.current, extraMarks))
    const nextMarks = { ...prevMarks.current }
    for (const [symbol, tick] of Object.entries(quotes)) {
      if (tick.last != null) nextMarks[symbol] = tick.last
    }
    for (const [symbol, px] of Object.entries(extraMarks)) {
      if (px > 0) nextMarks[symbol] = px
    }
    prevMarks.current = nextMarks
  }, [ready, quotes, candles, extraMarks])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void fetchAllWeatherOverview(true)
        .then(({ marks, meta }) => {
          if (cancelled) return
          setExtraMarks(marks)
          setAwMeta(meta)
        })
        .catch(() => {})
    }, 45_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [ready])

  const selectedPortfolio = state.portfolios.find((p) => p.id === selectedPortfolioId) || state.portfolios[0] || null

  const createPortfolio = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("请输入组合名称")
      return null
    }
    const id = nid("pf-")
    setState((prev) => ({ ...prev, portfolios: [...prev.portfolios, { id, name: trimmed, createdAt: Date.now() }] }))
    setSelectedPortfolioId(id)
    setError(null)
    return id
  }, [])

  const deletePortfolio = useCallback((id: string) => {
    if (id === ALL_WEATHER_PORTFOLIO_ID) {
      setError("全天候组合请用同步覆盖，不能直接删除")
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
      setState((prev) => {
        const opened = openPosition(prev, { portfolioId, symbol, side, lots, entryPrice })
        err = opened.error
        return opened.state
      })
      setError(err)
      return err
    },
    [],
  )

  const flatten = useCallback(
    (positionId: string) => {
      const pos = state.positions.find((p) => p.id === positionId)
      if (!pos) return
      const mark = markPrice(pos.symbol, quotes, candles, extraMarks)
      if (mark == null) {
        setError("暂无行情，无法平仓")
        return
      }
      setState((prev) => closePosition(prev, positionId, mark, "手动平仓"))
      setError(null)
    },
    [state.positions, quotes, candles, extraMarks],
  )

  const flattenAll = useCallback(() => {
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
  }, [selectedPortfolio, quotes, candles, extraMarks])

  const loadAllWeather = useCallback(async () => {
    setAwLoading(true)
    try {
      const { holdings, marks, meta } = await fetchAllWeatherOverview(true)
      if (!holdings.length) {
        setError("全天候策略暂无持仓")
        return null
      }
      setState((prev) => applyAllWeatherBook(prev, holdings))
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
      setState((prev) => applyAllWeatherBook(prev, holdings))
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
      return err ? null : id
    },
    [quotes, candles, extraMarks],
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
        const quote = quotes[product.symbol]
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
            strategy: state.strategies.find((s) => s.id === position.strategyId) || null,
          }
        }),
    [state.positions, state.strategies, quotes, candles, extraMarks, selectedPortfolio],
  )

  const summary = useMemo(() => {
    let unrealized = 0
    let realized = 0
    for (const pos of state.positions) {
      if (selectedPortfolio && pos.portfolioId !== selectedPortfolio.id) continue
      const mark = markPrice(pos.symbol, quotes, candles, extraMarks)
      const pnl = positionPnl(pos, mark)
      if (pnl == null) continue
      if (pos.status === "open") unrealized += pnl
      else realized += pnl
    }
    return {
      unrealized,
      realized,
      total: unrealized + realized,
      openCount: openPositions.length,
      productCount: selectedPortfolio ? state.products.filter((p) => p.portfolioId === selectedPortfolio.id).length : 0,
    }
  }, [state.positions, state.products, quotes, candles, extraMarks, openPositions.length, selectedPortfolio])

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
    rows,
    openPositions,
    summary,
  }
}

export type PaperTradingApi = ReturnType<typeof usePaperTrading>
