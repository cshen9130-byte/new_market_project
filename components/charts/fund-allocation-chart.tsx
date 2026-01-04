"use client"

import { useEffect, useRef } from "react"
import * as echarts from "echarts"

export default function FundAllocationChart() {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return

    const chart = echarts.init(chartRef.current)

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: "{a} <br/>{b}: {c}% ({d}%)",
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        borderColor: "#00ffff",
        textStyle: {
          color: "#00ffff",
        },
      },
      legend: {
        orient: "vertical",
        left: "left",
        textStyle: {
          color: "#00ffff",
        },
      },
      series: [
        {
          name: "Asset Allocation",
          type: "pie",
          radius: ["40%", "70%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 10,
            borderColor: "#000",
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: "{b}: {c}%",
            color: "#00ffff",
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 16,
              fontWeight: "bold",
            },
          },
          labelLine: {
            show: true,
            lineStyle: {
              color: "#00ffff",
            },
          },
          data: [
            { value: 35, name: "Equities", itemStyle: { color: "#00ff00" } },
            { value: 25, name: "Bonds", itemStyle: { color: "#00ffff" } },
            { value: 20, name: "Real Estate", itemStyle: { color: "#ff00ff" } },
            { value: 10, name: "Commodities", itemStyle: { color: "#ffff00" } },
            { value: 10, name: "Cash", itemStyle: { color: "#ff8800" } },
          ],
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

  return <div ref={chartRef} className="w-full h-[350px]" />
}
