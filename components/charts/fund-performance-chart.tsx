"use client"

import { useEffect, useRef } from "react"
import * as echarts from "echarts"

export default function FundPerformanceChart() {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return

    const chart = echarts.init(chartRef.current)

    const dates = []
    for (let i = 0; i < 12; i++) {
      const date = new Date()
      date.setMonth(date.getMonth() - (12 - i))
      dates.push(date.toLocaleDateString("en-US", { month: "short", year: "numeric" }))
    }

    const generateFundData = (base: number, volatility: number) => {
      const data = []
      let value = base
      for (let i = 0; i < 12; i++) {
        value += (Math.random() - 0.3) * volatility
        data.push(value.toFixed(2))
      }
      return data
    }

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        borderColor: "#00ffff",
        textStyle: {
          color: "#00ffff",
        },
      },
      legend: {
        data: ["Tech Growth", "Healthcare", "AI Innovation", "Balanced", "Index Fund"],
        textStyle: {
          color: "#00ffff",
        },
        top: "5%",
      },
      grid: {
        left: "10%",
        right: "10%",
        top: "15%",
        bottom: "10%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: {
          lineStyle: {
            color: "#00ffff",
          },
        },
      },
      yAxis: {
        type: "value",
        name: "Return (%)",
        axisLine: {
          lineStyle: {
            color: "#00ffff",
          },
        },
        splitLine: {
          lineStyle: {
            color: "rgba(0, 255, 255, 0.1)",
          },
        },
      },
      series: [
        {
          name: "Tech Growth",
          type: "line",
          data: generateFundData(0, 4),
          smooth: true,
          lineStyle: {
            color: "#00ff00",
            width: 2,
          },
        },
        {
          name: "Healthcare",
          type: "line",
          data: generateFundData(0, 3),
          smooth: true,
          lineStyle: {
            color: "#00ffff",
            width: 2,
          },
        },
        {
          name: "AI Innovation",
          type: "line",
          data: generateFundData(0, 5),
          smooth: true,
          lineStyle: {
            color: "#ff00ff",
            width: 2,
          },
        },
        {
          name: "Balanced",
          type: "line",
          data: generateFundData(0, 2),
          smooth: true,
          lineStyle: {
            color: "#ffff00",
            width: 2,
          },
        },
        {
          name: "Index Fund",
          type: "line",
          data: generateFundData(0, 2.5),
          smooth: true,
          lineStyle: {
            color: "#ff8800",
            width: 2,
          },
        },
      ],
    }

    chart.setOption(option)

    const handleResize = () => {
      chart.resize()
    }

    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      chart.dispose()
    }
  }, [])

  return <div ref={chartRef} className="w-full h-[400px]" />
}
