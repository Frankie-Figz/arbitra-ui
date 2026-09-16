"use client";

import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { wheelAngle, wheelDelta, wrapPosition } from "./ticker-wheel";
import styles from "./crypto-signal-ticker.module.css";

type Drag = { pointerId: number; angle: number; bounds: DOMRect };

/** Pointer capture keeps the circular drag attached to the handle even outside the wheel. */
export default function BitcoinTickerWheel({ onRotate, disabled = false }: { onRotate: (radians: number) => void; disabled?: boolean }) {
  const drag = useRef<Drag | null>(null);
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  const rotate = (delta: number) => {
    setRotation((previous) => wrapPosition(previous + delta * 180 / Math.PI, 360));
    onRotate(delta);
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const angle = wheelAngle(event.clientX, event.clientY, bounds);
    if (angle == null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, angle, bounds };
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const previous = drag.current;
    if (!previous || previous.pointerId !== event.pointerId) return;
    const angle = wheelAngle(event.clientX, event.clientY, previous.bounds);
    if (angle == null) return;
    event.preventDefault();
    rotate(wheelDelta(previous.angle, angle));
    previous.angle = angle;
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const steps: Record<string, number> = { ArrowRight: Math.PI / 6, ArrowUp: Math.PI / 6, ArrowLeft: -Math.PI / 6, ArrowDown: -Math.PI / 6, PageDown: Math.PI / 2, PageUp: -Math.PI / 2 };
    const delta = steps[event.key];
    if (delta === undefined) return;
    event.preventDefault(); rotate(delta);
  };

  return <div className={styles.steering}>
    <div><strong>Ticker paused</strong><p>Hold the gold handle and move in a circle to browse.<br />Clockwise moves forward · counterclockwise moves back.<br />Keyboard: ← / → or Page Up / Page Down.</p></div>
    <div className={`${styles.wheel} ${dragging ? styles.wheelDragging : ""}`} role="slider" tabIndex={disabled ? -1 : 0}
      aria-label="Bitcoin ticker steering wheel" aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.floor(rotation)}
      aria-valuetext={`${Math.floor(rotation)} degrees; rotate to browse signal cards`} aria-disabled={disabled}
      onPointerDown={down} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onKeyDown={keyboard}>
      <div className={styles.wheelRotor} style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true">
        <span className={styles.spoke} /><span className={`${styles.spoke} ${styles.spokeLeft}`} /><span className={`${styles.spoke} ${styles.spokeRight}`} />
        <span className={styles.wheelHandle} />
      </div>
      <span className={styles.bitcoinHub} aria-hidden="true">₿</span>
    </div>
  </div>;
}
