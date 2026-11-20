"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Action, Gear } from "@/types/game";

const gears: Gear[] = ["P", "R", "N", "D"];
const names: Record<Gear, string> = { P: "Park", R: "Reverse", N: "Neutral", D: "Drive" };
const toDegrees = 180 / Math.PI;
const maxRotation = 125;

interface Props {
  steering: number;
  gear: Gear;
  active: boolean;
  onGear: (gear: Gear) => void;
  onSteer: (steering: number | null) => void;
  onAction: (action: Action, active: boolean) => void;
}

function wheelAngle(event: PointerEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return Math.atan2(event.clientX - rect.left - rect.width / 2, rect.top + rect.height / 2 - event.clientY) * toDegrees;
}

export function DriveControls({ steering, gear, active, onGear, onSteer, onAction }: Props) {
  const drag = useRef<{ angle: number; rotation: number } | null>(null);
  const [shiftPosition, setShiftPosition] = useState<number | null>(null);

  function startWheel(event: PointerEvent<HTMLButtonElement>) {
    if (!active || event.button !== 0 || drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { angle: wheelAngle(event), rotation: steering * maxRotation };
    onSteer(steering);
  }

  function dragWheel(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const angle = wheelAngle(event);
    const change = (angle - drag.current.angle + 540) % 360 - 180;
    const rotation = Math.max(-maxRotation, Math.min(maxRotation, drag.current.rotation + change));
    drag.current = { angle, rotation };
    onSteer(rotation / maxRotation);
  }

  function stopWheel() {
    drag.current = null;
    onSteer(null);
  }

  function wheelKey(event: KeyboardEvent<HTMLButtonElement>, pressed: boolean) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onAction(event.key === "ArrowLeft" ? "left" : "right", pressed);
  }

  function shiftAtPoint(event: PointerEvent<HTMLSpanElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    const edge = 0.5 / gears.length;
    setShiftPosition(Math.max(edge, Math.min(1 - edge, ratio)));
    const slot = Math.max(0, Math.min(gears.length - 1, Math.floor(ratio * gears.length)));
    if (gears[slot] !== gear) onGear(gears[slot]);
  }

  return (
    <div className="drive-controls">
      <div className="steering-cluster">
        <button type="button" className="wheel-hit" aria-label="Steering wheel. Drag to turn, or use left and right arrows"
          disabled={!active}
          onPointerDown={startWheel} onPointerMove={dragWheel} onPointerUp={stopWheel}
          onPointerCancel={stopWheel} onLostPointerCapture={stopWheel}
          onKeyDown={(event) => wheelKey(event, true)} onKeyUp={(event) => wheelKey(event, false)}>
          <span className="wheel" style={{ transform: `rotate(${steering * maxRotation}deg)` }}>
            <span className="wheel-guide" />
            <span className="wheel-spoke wheel-spoke-left" />
            <span className="wheel-spoke wheel-spoke-right" />
            <span className="wheel-spoke wheel-spoke-base" />
            <span className="wheel-hub"><span /></span>
          </span>
        </button>
        <span className="control-caption">Steering</span>
      </div>
      <div className="gearbox" data-gear={gear} role="group" aria-label="Transmission">
        <span className="shift-track" aria-hidden="true" data-dragging={shiftPosition !== null}
          onPointerDown={(event) => {
            if (!active || event.button !== 0 || shiftPosition !== null) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            shiftAtPoint(event);
          }} onPointerMove={(event) => {
            if (active && event.currentTarget.hasPointerCapture(event.pointerId)) shiftAtPoint(event);
          }} onPointerUp={(event) => {
            if (active && event.currentTarget.hasPointerCapture(event.pointerId)) shiftAtPoint(event);
            setShiftPosition(null);
          }} onPointerCancel={() => setShiftPosition(null)} onLostPointerCapture={() => setShiftPosition(null)}>
          <i style={shiftPosition === null ? undefined : { top: `${shiftPosition * 100}%` }} />
        </span>
        {gears.map((value) => (
          <button key={value} type="button" className="gear"
            aria-label={names[value]} title={names[value]} aria-pressed={value === gear} disabled={!active}
            onClick={() => onGear(value)}>{value}</button>
        ))}
      </div>
      <div className="pedal-cluster" role="group" aria-label="Pedals">
        {(["brake", "pedal"] as const).map((action) => {
          const label = action === "brake" ? "Brake" : "Accelerate";
          return (
            <div key={action} className={`pedal-wrap pedal-wrap-${action}`}>
              <button type="button" className={`pedal pedal-${action}`} aria-label={label} disabled={!active}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onAction(action, true);
                }}
                onPointerUp={() => onAction(action, false)}
                onPointerCancel={() => onAction(action, false)}
                onLostPointerCapture={() => onAction(action, false)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") onAction(action, true);
                }}
                onKeyUp={() => onAction(action, false)}
                onBlur={() => onAction(action, false)}>
                <i /><i /><i /><i />
              </button>
              <span className="control-caption">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
