"use client"

import { useEffect, useRef } from "react"
import * as echarts from "echarts"

export default function MarketHeatmap() {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return

    const chart = echarts.init(chartRef.current)

    const sectors = [
      "Technology",
      "Healthcare",
      "Finance",
      "Consumer",
      "Energy",
      "Industrials",
      "Materials",
      "Utilities",
      "Real Estate",
      "Telecom",
    ]

    const data = sectors.map((sector, i) => {
      const performance = (Math.random() - 0.3) * 10
      return [i, 0, performance.toFixed(2)]
    })

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        position: "top",
        formatter: (params: any) => {
          return `${sectors[params.data[0]]}: ${params.data[2]}%`
        },
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        borderColor: "#00ffff",
        textStyle: {
          color: "#00ffff",
        },
      },
      grid: {
        left: "15%",
        right: "10%",
        top: "5%",
        bottom: "5%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: ["Performance"],
        splitArea: {
          show: true,
        },
        axisLine: {
          lineStyle: {
            color: "#00ffff",
          },
        },
      },
      yAxis: {
        type: "category",
        data: sectors,
        splitArea: {
          show: true,
        },
        axisLine: {
          lineStyle: {
            color: "#00ffff",
          },
        },
      },
      visualMap: {
        min: -5,
        max: 5,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: "0%",
        inRange: {
          color: ["#ff0000", "#ffff00", "#00ff00"],
        },
        textStyle: {
          color: "#00ffff",
        },
      },
      series: [
        {
          name: "Sector Performance",
          type: "heatmap",
          data: data,
          label: {
            show: true,
            formatter: (params: any) => `${params.data[2]}%`,
            color: "#000000",
            fontWeight: "bold",
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 255, 255, 0.5)",
            },
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
