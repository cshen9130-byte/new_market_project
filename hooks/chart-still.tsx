"use client"

import { createContext, useContext, type ReactNode } from "react"

const ChartStillContext = createContext(false)

export function ChartStillProvider({ children }: { children: ReactNode }) {
  return <ChartStillContext.Provider value={true}>{children}</ChartStillContext.Provider>
}

export function useChartStill(): boolean {
  return useContext(ChartStillContext)
}
