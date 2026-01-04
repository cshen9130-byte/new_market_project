"use client"

import { useEffect, useRef } from "react"
import * as echarts from "echarts"

export default function StockChart() {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return

    const chart = echarts.init(chartRef.current)

    // Generate sample data - replace with your API data
    const dates = []
    const prices = []
    const volumes = []
    let basePrice = 150

    for (let i = 0; i < 90; i++) {
      const date = new Date()
      date.setDate(date.getDate() - (90 - i))
      dates.push(date.toLocaleDateString())

      basePrice += (Math.random() - 0.5) * 5
      prices.push(basePrice.toFixed(2))
      volumes.push(Math.floor(Math.random() * 50000000 + 30000000))
    }

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
        },
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        borderColor: "#00ffff",
        textStyle: {
          color: "#00ffff",
        },
      },
      legend: {
        data: ["Price", "Volume"],
        textStyle: {
          color: "#00ffff",
        },
      },
      grid: [
        {
          left: "10%",
          right: "10%",
          top: "10%",
          height: "50%",
        },
        {
          left: "10%",
          right: "10%",
          top: "70%",
          height: "20%",
        },
      ],
      xAxis: [
        {
          type: "category",
          data: dates,
          gridIndex: 0,
          axisLine: {
            lineStyle: {
              color: "#00ffff",
            },
          },
        },
        {
          type: "category",
          data: dates,
          gridIndex: 1,
          axisLine: {
            lineStyle: {
              color: "#00ffff",
            },
          },
        },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
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
        {
          type: "value",
          gridIndex: 1,
          axisLine: {
            lineStyle: {
              color: "#00ffff",
            },
          },
          splitLine: {
            show: false,
          },
        },
      ],
      series: [
        {
          name: "Price",
          type: "line",
          data: prices,
          smooth: true,
          xAxisIndex: 0,
          yAxisIndex: 0,
          lineStyle: {
            color: "#00ff00",
            width: 2,
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(0, 255, 0, 0.3)" },
              { offset: 1, color: "rgba(0, 255, 0, 0.01)" },
            ]),
          },
        },
        {
          name: "Volume",
          type: "bar",
          data: volumes,
          xAxisIndex: 1,
          yAxisIndex: 1,
          itemStyle: {
            color: "#00ffff",
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
