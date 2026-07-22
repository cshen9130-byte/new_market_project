"use client"

import { Canvas } from "@react-three/fiber"
import { Html, OrbitControls } from "@react-three/drei"
import { useMemo, type ReactNode } from "react"
import * as THREE from "three"

export type IvSurfaceData = {
  strikes: number[]
  days_to_expiry: number[]
  heatmap: (number | null)[][]
  scatter?: Array<{ strike: number | null; days_to_expiry: number | null; iv: number | null }>
}

type SurfaceBounds = {
  geometry: THREE.BufferGeometry
  ivMin: number
  ivMax: number
  strikeMin: number
  strikeMax: number
  dteMin: number
  dteMax: number
  size: number
  yMax: number
}

const GRID_SIZE = 8

/** Matplotlib viridis approximation (t ∈ [0, 1]). */
function viridis(t: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t))
  const stops = [
    [0.267, 0.004, 0.329],
    [0.282, 0.14, 0.458],
    [0.127, 0.566, 0.551],
    [0.369, 0.788, 0.383],
    [0.993, 0.906, 0.144],
  ]
  const idx = clamped * (stops.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(stops.length - 1, lo + 1)
  const f = idx - lo
  const a = stops[lo]
  const b = stops[hi]
  return new THREE.Color(
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  )
}

function buildSurfaceGeometry(data: IvSurfaceData): SurfaceBounds | null {
  const rows = data.days_to_expiry.length
  const cols = data.strikes.length
  if (rows < 2 || cols < 2) return null

  const strikeMin = data.strikes[0]
  const strikeMax = data.strikes[cols - 1]
  const dteMin = data.days_to_expiry[0]
  const dteMax = data.days_to_expiry[rows - 1]

  let ivMin = Infinity
  let ivMax = -Infinity
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const iv = data.heatmap[j]?.[i]
      if (iv != null && !Number.isNaN(iv)) {
        ivMin = Math.min(ivMin, iv)
        ivMax = Math.max(ivMax, iv)
      }
    }
  }
  if (!Number.isFinite(ivMin)) return null

  const spanX = strikeMax - strikeMin || 1
  const spanZ = dteMax - dteMin || 1
  const spanY = ivMax - ivMin || 1
  const size = GRID_SIZE
  const half = size / 2
  const yMax = size * 0.6

  const vertices: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const rawIv = data.heatmap[j]?.[i]
      const iv = rawIv ?? ivMin
      const t = (iv - ivMin) / spanY
      const x = ((data.strikes[i] - strikeMin) / spanX - 0.5) * size
      const z = ((data.days_to_expiry[j] - dteMin) / spanZ - 0.5) * size
      const y = ((iv - ivMin) / spanY) * yMax
      vertices.push(x, y, z)
      const c = viridis(t)
      colors.push(c.r, c.g, c.b)
    }
  }

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i
      indices.push(a, a + 1, a + cols + 1, a, a + cols + 1, a + cols)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return { geometry, ivMin, ivMax, strikeMin, strikeMax, dteMin, dteMax, size, yMax }
}

function AxisLine({ from, to, color }: { from: THREE.Vector3; to: THREE.Vector3; color: string }) {
  const points = useMemo(() => [from, to], [from, to])
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points)
    return g
  }, [points])

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color={color} linewidth={1} />
    </line>
  )
}

function AxisLabel({ position, children }: { position: [number, number, number]; children: ReactNode }) {
  return (
    <Html position={position} center style={{ pointerEvents: "none" }}>
      <div className="whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 shadow-sm border border-gray-200">
        {children}
      </div>
    </Html>
  )
}

function AxisGizmo({ bounds }: { bounds: SurfaceBounds }) {
  const half = bounds.size / 2
  const origin = useMemo(() => new THREE.Vector3(-half, 0, -half), [half])
  const xEnd = useMemo(() => new THREE.Vector3(half, 0, -half), [half])
  const zEnd = useMemo(() => new THREE.Vector3(-half, 0, half), [half])
  const yEnd = useMemo(() => new THREE.Vector3(-half, bounds.yMax, -half), [half, bounds.yMax])

  return (
    <group>
      <AxisLine from={origin} to={xEnd} color="#2563eb" />
      <AxisLine from={origin} to={zEnd} color="#16a34a" />
      <AxisLine from={origin} to={yEnd} color="#9333ea" />

      <AxisLabel position={[0, -0.35, -half - 0.55]}>
        X · 行权价 {bounds.strikeMin.toFixed(2)} – {bounds.strikeMax.toFixed(2)}
      </AxisLabel>
      <AxisLabel position={[-half - 1.1, bounds.yMax * 0.5, -half - 0.2]}>
        Y · IV (%) {bounds.ivMin.toFixed(0)} – {bounds.ivMax.toFixed(0)}
      </AxisLabel>
      <AxisLabel position={[-half - 0.2, -0.35, 0]}>
        Z · 到期天数 {bounds.dteMin} – {bounds.dteMax}D
      </AxisLabel>
    </group>
  )
}

function SurfaceMesh({ bounds }: { bounds: SurfaceBounds }) {
  return (
    <mesh geometry={bounds.geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} metalness={0.05} roughness={0.65} />
    </mesh>
  )
}

function ScatterDots({ data, bounds }: { data: IvSurfaceData; bounds: SurfaceBounds }) {
  const geometry = useMemo(() => {
    const scatter = data.scatter?.filter(
      (p) => p.strike != null && p.days_to_expiry != null && p.iv != null,
    )
    if (!scatter?.length) return null

    const spanX = bounds.strikeMax - bounds.strikeMin || 1
    const spanZ = bounds.dteMax - bounds.dteMin || 1
    const spanY = bounds.ivMax - bounds.ivMin || 1
    const half = bounds.size / 2

    const positions: number[] = []
    for (const p of scatter) {
      const x = ((p.strike! - bounds.strikeMin) / spanX - 0.5) * bounds.size
      const z = ((p.days_to_expiry! - bounds.dteMin) / spanZ - 0.5) * bounds.size
      const y = ((p.iv! - bounds.ivMin) / spanY) * bounds.yMax
      positions.push(x, y, z)
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    return g
  }, [data, bounds])

  if (!geometry) return null

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.12} color="#ffffff" transparent opacity={0.75} sizeAttenuation />
    </points>
  )
}

function Scene({ data }: { data: IvSurfaceData }) {
  const bounds = useMemo(() => buildSurfaceGeometry(data), [data])
  if (!bounds) return null

  return (
    <>
      <color attach="background" args={["#fafafa"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 10, 4]} intensity={0.9} />
      <directionalLight position={[-4, 6, -6]} intensity={0.35} />
      <SurfaceMesh bounds={bounds} />
      <ScatterDots data={data} bounds={bounds} />
      <AxisGizmo bounds={bounds} />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        minDistance={5}
        maxDistance={20}
        target={[0, bounds.yMax * 0.35, 0]}
      />
      <gridHelper
        args={[bounds.size + 2, 10, "#e5e5e5", "#f0f0f0"]}
        position={[0, -0.01, 0]}
      />
    </>
  )
}

export default function IvSurface3DChart({
  data,
  height = 380,
}: {
  data: IvSurfaceData
  height?: number
}) {
  return (
    <div className="relative w-full rounded-lg border bg-[#fafafa]" style={{ height }}>
      <Canvas
        camera={{ position: [7, 6, 7], fov: 40, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <Scene data={data} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-muted-foreground">
        拖拽旋转 · 滚轮缩放
      </div>
      <div className="pointer-events-none absolute right-2 top-2 flex h-24 w-3 flex-col rounded-sm border bg-white p-0.5">
        <div
          className="h-full w-full rounded-sm"
          style={{
            background: "linear-gradient(to top, #440154, #31688e, #35b779, #fde725)",
          }}
        />
        <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
          <span>低</span>
          <span>高</span>
        </div>
      </div>
    </div>
  )
}
