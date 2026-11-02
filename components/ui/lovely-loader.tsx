"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

const FACES = ["front", "back", "right", "left", "top", "bottom"] as const

/**
 * A large candy-colored cube that floats and turns in 3D.
 * Portaled to the document so it sits above the page, not inside the table.
 */
export function LovelyLoaderOverlay({ label = "正在加载" }: { label?: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <div className="ll-overlay" role="status" aria-live="polite" aria-label={label}>
      <div className="ll-float">
        <span className="ll-spark ll-spark-a" />
        <span className="ll-spark ll-spark-b" />
        <span className="ll-spark ll-spark-c" />
        <div className="ll-scene">
          <div className="ll-cube">
            {FACES.map((face) => (
              <div key={face} className={`ll-face ll-${face}`}>
                {face === "front" && (
                  <>
                    <span className="ll-eye ll-eye-l" />
                    <span className="ll-eye ll-eye-r" />
                    <span className="ll-blush ll-blush-l" />
                    <span className="ll-blush ll-blush-r" />
                    <span className="ll-smile" />
                  </>
                )}
                <span className="ll-gloss" />
              </div>
            ))}
          </div>
        </div>
        <div className="ll-shadow" />
      </div>
      <p className="ll-label">{label}</p>
      <style>{LOADER_CSS}</style>
    </div>,
    document.body,
  )
}

const LOADER_CSS = `
.ll-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(255,255,255,0.55), rgba(255,255,255,0.08) 42%, transparent 68%);
}
.ll-float {
  position: relative;
  width: 320px;
  height: 320px;
  display: grid;
  place-items: center;
  animation: ll-float 2.8s ease-in-out infinite;
}
.ll-scene {
  width: 200px;
  height: 200px;
  perspective: 800px;
}
.ll-cube {
  width: 200px;
  height: 200px;
  position: relative;
  transform-style: preserve-3d;
  animation: ll-tumble 3.6s ease-in-out infinite;
}
.ll-face {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  border-radius: 28px;
  border: 4px solid rgba(255,255,255,0.8);
  box-shadow: inset 0 -18px 24px rgba(90, 30, 60, 0.12);
  backface-visibility: hidden;
  overflow: hidden;
}
.ll-gloss {
  position: absolute;
  left: 14px;
  top: 12px;
  width: 58%;
  height: 28%;
  border-radius: 40px;
  background: linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0));
}
.ll-front { background: linear-gradient(160deg, #ffe1ec 0%, #ff7aa2 55%, #ff4d88 100%); transform: translateZ(100px); }
.ll-back { background: linear-gradient(160deg, #d7dcff 0%, #7c83f7 100%); transform: rotateY(180deg) translateZ(100px); }
.ll-right { background: linear-gradient(160deg, #d8fff4 0%, #2ec9a8 100%); transform: rotateY(90deg) translateZ(100px); }
.ll-left { background: linear-gradient(160deg, #fff3c4 0%, #ffb703 100%); transform: rotateY(-90deg) translateZ(100px); }
.ll-top { background: linear-gradient(160deg, #e7f3ff 0%, #5aa8ff 100%); transform: rotateX(90deg) translateZ(100px); }
.ll-bottom { background: linear-gradient(160deg, #ffe0d2 0%, #ff7a4d 100%); transform: rotateX(-90deg) translateZ(100px); }
.ll-eye {
  position: absolute;
  top: 64px;
  width: 26px;
  height: 32px;
  border-radius: 50%;
  background: #3a2744;
  animation: ll-blink 3.4s ease-in-out infinite;
}
.ll-eye::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
}
.ll-eye-l { left: 48px; }
.ll-eye-r { right: 48px; }
.ll-blush {
  position: absolute;
  top: 104px;
  width: 22px;
  height: 12px;
  border-radius: 50%;
  background: rgba(255, 90, 120, 0.45);
}
.ll-blush-l { left: 28px; }
.ll-blush-r { right: 28px; }
.ll-smile {
  position: absolute;
  left: 68px;
  top: 116px;
  width: 48px;
  height: 26px;
  border: 5px solid #3a2744;
  border-top: 0;
  border-radius: 0 0 40px 40px;
}
.ll-shadow {
  position: absolute;
  bottom: 6px;
  width: 140px;
  height: 24px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(255, 90, 140, 0.38), rgba(90, 140, 255, 0.08) 60%, transparent 72%);
  animation: ll-shadow 2.8s ease-in-out infinite;
}
.ll-spark {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #fff4a8;
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
  filter: drop-shadow(0 0 6px rgba(255, 196, 80, 0.9));
}
.ll-spark-a { top: 28px; right: 36px; background: #ffe56a; animation: ll-spark 2.2s ease-in-out infinite; }
.ll-spark-b { top: 78px; left: 22px; width: 12px; height: 12px; background: #9af0ff; animation: ll-spark 2.6s ease-in-out 0.4s infinite; }
.ll-spark-c { bottom: 64px; right: 28px; width: 11px; height: 11px; background: #ffb0d0; animation: ll-spark 2.4s ease-in-out 0.8s infinite; }
.ll-label {
  margin: 10px 0 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #b4234a;
  text-shadow: 0 1px 0 rgba(255,255,255,0.8);
}
@keyframes ll-float {
  0%, 100% { transform: translateY(10px); }
  50% { transform: translateY(-26px); }
}
@keyframes ll-shadow {
  0%, 100% { transform: scaleX(1); opacity: 0.85; }
  50% { transform: scaleX(0.72); opacity: 0.4; }
}
@keyframes ll-tumble {
  0%, 100% { transform: rotateX(-24deg) rotateY(-36deg); }
  50% { transform: rotateX(-14deg) rotateY(32deg); }
}
@keyframes ll-blink {
  0%, 42%, 48%, 100% { transform: scaleY(1); }
  45% { transform: scaleY(0.12); }
}
@keyframes ll-spark {
  0%, 100% { transform: scale(0.7) rotate(0deg); opacity: 0.45; }
  50% { transform: scale(1.25) rotate(20deg); opacity: 1; }
}
`