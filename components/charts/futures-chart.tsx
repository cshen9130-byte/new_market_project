"use client"

import { useEffect, useRef } from "react"
import * as echarts from "echarts"

export default function FuturesChart() {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return

    const chart = echarts.init(chartRef.current)

    // Generate sample data for multiple futures contracts
    const dates = []
    for (let i = 0; i < 30; i++) {
      const date = new Date()
      date.setDate(date.getDate() - (30 - i))
      dates.push(date.toLocaleDateString())
    }

    const generateContractData = (basePr: number) => {
      const data = []
      let price = basePr
      for (let i = 0; i < 30; i++) {
        price += (Math.random() - 0.5) * 2
        data.push(price.toFixed(2))
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
        data: ["Gold", "Crude Oil", "Natural Gas", "Silver"],
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
          name: "Gold",
          type: "line",
          data: generateContractData(2100),
          smooth: true,
          lineStyle: {
            color: "#FFD700",
            width: 2,
          },
        },
        {
          name: "Crude Oil",
          type: "line",
          data: generateContractData(75),
          smooth: true,
          lineStyle: {
            color: "#00ff00",
            width: 2,
          },
        },
        {
          name: "Natural Gas",
          type: "line",
          data: generateContractData(2.8),
          smooth: true,
          lineStyle: {
            color: "#ff00ff",
            width: 2,
          },
        },
        {
          name: "Silver",
          type: "line",
          data: generateContractData(24),
          smooth: true,
          lineStyle: {
            color: "#C0C0C0",
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

  return <div ref={chartRef} className="w-full h-[500px]" />
}
