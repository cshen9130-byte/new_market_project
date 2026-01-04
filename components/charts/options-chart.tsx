"use client"

import { useEffect, useRef } from "react"
import * as echarts from "echarts"

export default function OptionsChart() {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current) return

    const chart = echarts.init(chartRef.current)

    const strikes = []
    const callVolume = []
    const putVolume = []
    const callOI = []
    const putOI = []

    // Generate sample options data around ATM strike of 450
    for (let i = 420; i <= 480; i += 5) {
      strikes.push(`$${i}`)

      const distanceFromATM = Math.abs(i - 450)
      const volumeMultiplier = Math.max(0.2, 1 - distanceFromATM / 60)

      callVolume.push(Math.floor(Math.random() * 50000 * volumeMultiplier + 10000))
      putVolume.push(Math.floor(Math.random() * 50000 * volumeMultiplier + 10000))
      callOI.push(Math.floor(Math.random() * 100000 * volumeMultiplier + 20000))
      putOI.push(Math.floor(Math.random() * 100000 * volumeMultiplier + 20000))
    }

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        borderColor: "#00ffff",
        textStyle: {
          color: "#00ffff",
        },
      },
      legend: {
        data: ["Call Volume", "Put Volume", "Call OI", "Put OI"],
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
        data: strikes,
        axisLine: {
          lineStyle: {
            color: "#00ffff",
          },
        },
        axisLabel: {
          rotate: 45,
        },
      },
      yAxis: [
        {
          type: "value",
          name: "Volume",
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
          name: "Open Interest",
          axisLine: {
            lineStyle: {
              color: "#ff00ff",
            },
          },
          splitLine: {
            show: false,
          },
        },
      ],
      series: [
        {
          name: "Call Volume",
          type: "bar",
          data: callVolume,
          itemStyle: {
            color: "#00ff00",
          },
        },
        {
          name: "Put Volume",
          type: "bar",
          data: putVolume,
          itemStyle: {
            color: "#ff0000",
          },
        },
        {
          name: "Call OI",
          type: "line",
          yAxisIndex: 1,
          data: callOI,
          lineStyle: {
            color: "#00ffff",
            width: 2,
          },
        },
        {
          name: "Put OI",
          type: "line",
          yAxisIndex: 1,
          data: putOI,
          lineStyle: {
            color: "#ff00ff",
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
