"use client"

import { useRef, useMemo, useState, useEffect } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Sphere, Line, Text, Html } from "@react-three/drei"
import type * as THREE from "three"
import { AdditiveBlending } from "three"

interface NeuronLayerProps {
  position: [number, number, number]
  positions: Array<[number, number, number]>
  label: string
  color: string
  radius?: number
  onNodeClick?: (index: number) => void
}

// Render neurons from provided local YZ positions; allows shared positions for dense connections
function NeuronLayer({ position, positions, label, color, radius = 0.075, onNodeClick }: NeuronLayerProps) {
  return (
    <group position={position}>
      {positions.map((p, i) => (
        <Neuron
          key={i}
          position={p}
          color={color}
          label={label}
          index={i}
          radius={radius}
          onClick={onNodeClick}
        />
      ))}
    </group>
  )
}

interface NeuronProps {
  position: [number, number, number]
  color: string
  label: string
  index: number
  radius?: number
  onClick?: (index: number) => void
}

function Neuron({ position, color, label, index, radius = 0.08, onClick }: NeuronProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.scale.setScalar(hovered ? 1.25 : 1)
    }
  })

  return (
    <group position={position}>
      <Sphere
        ref={meshRef}
        args={[radius, 12, 12]}
        onClick={() => onClick?.(index)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 1.3 : 0.7}
          roughness={0.2}
          metalness={0.6}
          clearcoat={0.9}
          clearcoatRoughness={0.15}
          transmission={0.05}
          ior={1.2}
          thickness={0.2}
          toneMapped={false}
        />
      </Sphere>
    </group>
  )
}

function SegmentConnections({ absolutePositions, perNeuron = 4, perLayerCap = 480, highlightCount = 160 }: { absolutePositions: Array<Array<[number, number, number]>>; perNeuron?: number; perLayerCap?: number; highlightCount?: number }) {
  const basePositions = useMemo(() => {
    const coords: number[] = []
    for (let l = 0; l < absolutePositions.length - 1; l++) {
      const layerA = absolutePositions[l]
      const layerB = absolutePositions[l + 1]
      const picksPerA = Math.max(1, Math.min(perNeuron, Math.floor(layerB.length / 2)))
      let added = 0
      for (let i = 0; i < layerA.length; i++) {
        const targets = new Set<number>()
        while (targets.size < picksPerA) targets.add(Math.floor(Math.random() * layerB.length))
        for (const j of targets) {
          const [ax, ay, az] = layerA[i]
          const [bx, by, bz] = layerB[j]
          coords.push(ax, ay, az, bx, by, bz)
          added++
          if (added >= perLayerCap) break
        }
        if (added >= perLayerCap) break
      }
    }
    return new Float32Array(coords)
  }, [absolutePositions, perNeuron, perLayerCap])

  const [pulse, setPulse] = useState(0)
  useFrame((_, delta) => setPulse((p) => (p + delta * 0.9) % 2))

  const highlightPositions = useMemo(() => {
    const totalSegments = basePositions.length / 6
    const count = Math.min(highlightCount, Math.floor(totalSegments * 0.08) + 40)
    const indices = new Set<number>()
    while (indices.size < count && indices.size < totalSegments) indices.add(Math.floor(Math.random() * totalSegments))
    const coords: number[] = []
    indices.forEach((idx) => {
      const offset = idx * 6
      coords.push(
        basePositions[offset + 0],
        basePositions[offset + 1],
        basePositions[offset + 2],
        basePositions[offset + 3],
        basePositions[offset + 4],
        basePositions[offset + 5]
      )
    })
    return new Float32Array(coords)
  }, [basePositions, highlightCount])

  const glowOpacity = 0.35 + Math.abs(Math.sin(pulse * Math.PI)) * 0.4

  return (
    <>
      <lineSegments>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" array={basePositions} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color="#00ffff" transparent opacity={0.12} />
      </lineSegments>
      <lineSegments>
        <bufferGeometry>
          {/* @ts-ignore */}
          <bufferAttribute attach="attributes-position" array={highlightPositions} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color="#ffff88" transparent opacity={glowOpacity} blending={AdditiveBlending} />
      </lineSegments>
    </>
  )
}

function LayerLabel({ position, text }: { position: [number, number, number]; text: string }) {
  return (
    <Html position={position} center transform>
      <div className="pointer-events-none px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-xs font-semibold border border-cyan-400/40">
        {text}
      </div>
    </Html>
  )
}

interface NeuralNetwork3DProps {
  onInputClick: (type: string) => void
  onOutputClick: (type: string) => void
}

function Scene({ onInputClick, onOutputClick }: NeuralNetwork3DProps) {
  const inputLabels = ["股票", "期货", "期权"]
  const outputLabels = ["市场状态", "基金表现"]

  const handleInputClick = (index: number) => {
    const types = ["stock", "futures", "options"]
    onInputClick(types[index])
  }

  const handleOutputClick = (index: number) => {
    const types = ["market", "fund"]
    onOutputClick(types[index])
  }

  // Layout configuration (3D, modern grid, fits screen)
  const hiddenLayerCount = 14
  const spacingX = 1.25
  const spacingY = 0.95
  // Compute hidden layer X positions centered, then flank with IO layers
  const hiddenXs = useMemo(
    () => Array.from({ length: hiddenLayerCount }, (_, i) => i * spacingX - ((hiddenLayerCount - 1) * spacingX) / 2),
    [hiddenLayerCount, spacingX]
  )

  const inputX = hiddenXs[0] - spacingX * 1.8
  const outputX = hiddenXs[hiddenLayerCount - 1] + spacingX * 1.8

  // Fine-grained offsets for IO buttons, labels, and neurons
  const inputButtonOffset = 0.55
  const outputButtonOffset = 0.25
  const inputNeuronXOffset = 0.7
  const outputNeuronXOffset = -1.2
  const inputYDelta = 1.6
  const outputYDelta = 1.2

  // Variable neuron counts for each hidden layer to look nicer
  const hiddenCounts = useMemo(() => {
    const counts: number[] = []
    for (let i = 0; i < hiddenLayerCount; i++) {
      const base = 12 + Math.floor(6 * Math.sin(i * 0.28) + 4 * Math.cos(i * 0.17))
      const variation = Math.floor(Math.random() * 5)
      counts.push(Math.max(10, base + variation))
    }
    return counts
  }, [hiddenLayerCount])

  // Layer positions across X and Z with a gentle wave; inputs/outputs at z=0 to keep IO near buttons
  const layers = useMemo(() => {
    const pos: Array<[number, number, number]> = []
    pos.push([inputX, 0, 0])
    for (let i = 0; i < hiddenLayerCount; i++) {
      const x = hiddenXs[i]
      // Subtle sinusoidal drift for modern feel
      const z = Math.sin(i * 0.24) * 2.6 + Math.cos(i * 0.15) * 1.2
      const y = Math.sin(i * 0.18) * 0.75
      pos.push([x, y, z])
    }
    pos.push([outputX, 0, 0])
    return pos
  }, [hiddenLayerCount, hiddenXs, inputX, outputX])

  const neuronCounts = useMemo(() => {
    const counts: number[] = []
    counts.push(3)
    for (let i = 0; i < hiddenLayerCount; i++) counts.push(hiddenCounts[i])
    counts.push(2)
    return counts
  }, [hiddenLayerCount, hiddenCounts])

  // Compute per-layer local grid positions (modern cube-like look)
  const gridPositionsForCount = (count: number, cell = spacingY): Array<[number, number, number]> => {
    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    const width = (cols - 1) * cell * 1.05
    const height = (rows - 1) * cell * 1.05
    const pts: Array<[number, number, number]> = []
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      const y = r * cell - height / 2
      const z = c * cell - width / 2
      // Micro rotation + jitter for high-tech feel
      const angle = (r + c) * 0.03
      const jy = (Math.random() - 0.5) * cell * 0.06
      const jz = (Math.random() - 0.5) * cell * 0.06
      const cy = y * Math.cos(angle) - z * Math.sin(angle) + jy
      const cz = y * Math.sin(angle) + z * Math.cos(angle) + jz
      pts.push([0, cy, cz])
    }
    return pts
  }

  const layerLocalNeuronPositions: Array<Array<[number, number, number]>> = useMemo(() => {
    const arr: Array<Array<[number, number, number]>> = []
    // Align input neurons next to each input button (same Y, near Z=0)
    const inputBtnY = [0, -spacingY * 2.0, -spacingY * 4.0]
    arr.push(inputBtnY.map((y) => [inputNeuronXOffset, y + inputYDelta, 0]))
    // hidden
    for (let i = 0; i < hiddenLayerCount; i++) {
      arr.push(gridPositionsForCount(hiddenCounts[i], spacingY))
    }
    // Align output neurons next to each output button (same Y)
    const outputBtnY = [0, -spacingY * 2.0]
    arr.push(outputBtnY.map((y) => [outputNeuronXOffset, y + outputYDelta, 0]))
    return arr
  }, [hiddenLayerCount, hiddenCounts, spacingY])

  const absoluteNeuronPositions: Array<Array<[number, number, number]>> = useMemo(() => {
    return layerLocalNeuronPositions.map((local, l) => {
      const [lx, ly, lz] = layers[l]
      return local.map(([x, y, z]) => [lx + x, ly + y, lz + z])
    })
  }, [layerLocalNeuronPositions, layers])

  // Animated signal path across layers
  const [pathSegments, setPathSegments] = useState<Array<{ start: [number, number, number]; end: [number, number, number] }>>([])
  const [pathAge, setPathAge] = useState(0)

  const regeneratePath = () => {
    const segments: Array<{ start: [number, number, number]; end: [number, number, number] }> = []
    // pick an input neuron
    let currentIdx = Math.floor(Math.random() * neuronCounts[0])
    let [currentX, currentY, currentZ] = absoluteNeuronPositions[0][currentIdx]

    for (let l = 1; l < layers.length; l++) {
      const nextCount = neuronCounts[l]
      const nextIdx = Math.floor(Math.random() * nextCount)
      const [nextX, nextY, nextZ] = absoluteNeuronPositions[l][nextIdx]
      // Directly connect neuron to neuron in true 3D
      segments.push({ start: [currentX, currentY, currentZ], end: [nextX, nextY, nextZ] })
      currentIdx = nextIdx
      currentY = nextY
      currentX = nextX
      currentZ = nextZ
    }
    setPathSegments(segments)
    setPathAge(0)
  }

  useFrame((_, delta) => {
    setPathAge((age) => {
      const next = age + delta
      if (next > 2.8) {
        regeneratePath()
        return 0
      }
      return next
    })
  })

  // Initial path
  useMemo(() => {
    regeneratePath()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Color helper: smooth gradient across hidden layers
  const hiddenColor = (i: number) => {
    const t = i / Math.max(1, hiddenLayerCount - 1)
    const hue = 180 + t * 120 // cyan → magenta
    return `hsl(${hue}, 90%, 60%)`
  }

  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} intensity={1.25} />
      <pointLight position={[-10, -10, -10]} intensity={0.7} color="#00ffff" />

      {/* Input layer */}
      <group scale={[1.35, 1.35, 1.35]}>
        {(() => {
          // Labels just above target buttons inside scaled group
          const inputTopY = -spacingY * (2 - 2) * 2.0 // 期权 top input
          const outputTopY = -spacingY * (1 - 1) * 2.0 // 基金表现 top output
          const inputLabelPos: [number, number, number] = [inputX - inputButtonOffset, inputTopY + inputYDelta + 0.9, 0]
          const outputLabelPos: [number, number, number] = [outputX + outputButtonOffset, outputTopY + outputYDelta + 0.9, 0]
          return (
            <>
              <LayerLabel position={inputLabelPos} text="输入层" />
              <LayerLabel position={outputLabelPos} text="输出层" />
            </>
          )
        })()}
        
        <NeuronLayer position={[inputX, 0, 0]} positions={layerLocalNeuronPositions[0]} label="input" color="#00ff88" radius={0.22} onNodeClick={handleInputClick} />

      {/* Hidden layers */}
      {Array.from({ length: hiddenLayerCount }).map((_, i) => (
        <NeuronLayer
          key={`hidden-${i}`}
          position={[layers[i + 1][0], layers[i + 1][1], layers[i + 1][2]]}
          positions={layerLocalNeuronPositions[i + 1]}
          label="hidden"
          color={hiddenColor(i)}
          radius={0.085}
        />
      ))}

      {/* Output layer */}
      <NeuronLayer position={[outputX, 0, 0]} positions={layerLocalNeuronPositions[layerLocalNeuronPositions.length - 1]} label="output" color="#ff55ff" radius={0.22} onNodeClick={handleOutputClick} />

      {/* Efficient line segments with glow highlights */}
      <SegmentConnections absolutePositions={absoluteNeuronPositions} perNeuron={4} perLayerCap={520} highlightCount={220} />

      {/* Animated signal path */}
      {pathSegments.map((seg, i) => {
        const headProgress = Math.min(1, Math.max(0, (pathAge - i * 0.03) / 0.6))
        const opacity = Math.max(0, 1 - Math.abs(headProgress - 0.8))
        return (
          <Line
            key={`path-${i}`}
            points={[seg.start, seg.end]}
            color="#ffff66"
            lineWidth={1.25}
            transparent
            opacity={Math.min(0.85, 0.22 + opacity)}
          />
        )
      })}

      {/* Clickable HTML buttons for inputs */}
      {inputLabels.map((label, i) => (
        <Html key={`input-${i}`} position={[inputX - inputButtonOffset, -spacingY * (2 - i) * 2.0 + inputYDelta, 0]} center transform>
          <button
            onClick={() => handleInputClick(i)}
            className="px-3 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold shadow-md border border-emerald-300"
          >
            {label}
          </button>
        </Html>
      ))}

      {/* Clickable HTML buttons for outputs */}
      {outputLabels.map((label, i) => (
        <Html key={`output-${i}`} position={[outputX + outputButtonOffset, -spacingY * (1 - i) * 2.0 + outputYDelta, 0]} center transform>
          <button
            onClick={() => handleOutputClick(i)}
            className="px-3 py-1 rounded-md bg-fuchsia-500 hover:bg-fuchsia-400 text-black text-sm font-semibold shadow-md border border-fuchsia-300"
          >
            {label}
          </button>
        </Html>
      ))}
      {/* Neon grid backdrop */}
      {/* @ts-ignore */}
      <gridHelper args={[200, 50, "#0ea5b7", "#073b4c"]} position={[0, -10, 0]} />
      </group>

      <OrbitControls enableZoom enablePan minDistance={14} maxDistance={40} autoRotate autoRotateSpeed={0.5} />
    </>
  )
}

export function NeuralNetwork3D({ onInputClick, onOutputClick }: NeuralNetwork3DProps) {
  const [webglOk, setWebglOk] = useState(true)

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas")
      const gl =
        (canvas.getContext("webgl2") as WebGLRenderingContext | null) ||
        (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
        (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null)
      setWebglOk(!!gl)
    } catch {
      setWebglOk(false)
    }
  }, [])

  if (!webglOk) {
    return (
      <div className="w-full h-[100svh] flex items-center justify-center bg-[#020611]">
        <div className="max-w-lg w-full px-6 py-4 rounded-lg border border-cyan-500/30 bg-black/40 text-cyan-300 space-y-4">
          <div className="text-sm">
            当前环境无法创建 WebGL 上下文，已显示简化界面。
          </div>
          <div className="space-y-2">
            <div className="text-xs opacity-80">输入层</div>
            <div className="flex gap-2 flex-wrap">
              {[
                { label: "股票", type: "stock" },
                { label: "期货", type: "futures" },
                { label: "期权", type: "options" },
              ].map((b) => (
                <button
                  key={b.type}
                  onClick={() => onInputClick(b.type)}
                  className="px-3 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold shadow-md border border-emerald-300"
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs opacity-80">输出层</div>
            <div className="flex gap-2 flex-wrap">
              {[
                { label: "市场状态", type: "market" },
                { label: "基金表现", type: "fund" },
              ].map((b) => (
                <button
                  key={b.type}
                  onClick={() => onOutputClick(b.type)}
                  className="px-3 py-1 rounded-md bg-fuchsia-500 hover:bg-fuchsia-400 text-black text-sm font-semibold shadow-md border border-fuchsia-300"
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-[100svh]">
      <Canvas
        camera={{ position: [0, 0, 24], fov: 56 }}
        gl={{ antialias: false, alpha: true, preserveDrawingBuffer: false, powerPreference: "low-power" }}
      >
        <color attach="background" args={["#020611"]} />
        {/* Subtle fog for depth */}
        {/* @ts-ignore */}
        <fog attach="fog" args={["#020611", 40, 120]} />
        <Scene onInputClick={onInputClick} onOutputClick={onOutputClick} />
      </Canvas>
    </div>
  )
}

