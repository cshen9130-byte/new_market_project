"use client"

import { useEffect, useRef } from "react"
import * as echarts from "echarts"

export default function MarketConditionChart() {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return

    const chart = echarts.init(chartRef.current)

    const dates = []
    for (let i = 0; i < 90; i++) {
      const date = new Date()
      date.setDate(date.getDate() - (90 - i))
      dates.push(date.toLocaleDateString())
    }

    const generateIndexData = (base: number) => {
      const data = []
      let value = base
      for (let i = 0; i < 90; i++) {
        value += (Math.random() - 0.45) * (base * 0.01)
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
        data: ["S&P 500", "NASDAQ", "Dow Jones", "Russell 2000"],
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
          name: "S&P 500",
          type: "line",
          data: generateIndexData(4500),
          smooth: true,
          lineStyle: {
            color: "#00ff00",
            width: 2,
          },
        },
        {
          name: "NASDAQ",
          type: "line",
          data: generateIndexData(14000),
          smooth: true,
          lineStyle: {
            color: "#00ffff",
            width: 2,
          },
        },
        {
          name: "Dow Jones",
          type: "line",
          data: generateIndexData(35000),
          smooth: true,
          lineStyle: {
            color: "#ff00ff",
            width: 2,
          },
        },
        {
          name: "Russell 2000",
          type: "line",
          data: generateIndexData(1950),
          smooth: true,
          lineStyle: {
            color: "#ffff00",
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
