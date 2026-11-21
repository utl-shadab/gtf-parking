"use client";

import { useRef, useState, type PointerEvent } from "react";

const center = { x: 0, z: 0 };

export function CityJoystick({ onMove }: { onMove: (value: typeof center) => void }) {
  const [thumb, setThumb] = useState(center);
  const pointer = useRef<number | null>(null);

  function move(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerId !== pointer.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - bounds.left - bounds.width / 2) / (bounds.width * 0.37);
    const rawZ = (event.clientY - bounds.top - bounds.height / 2) / (bounds.height * 0.37);
    const length = Math.max(1, Math.hypot(rawX, rawZ));
    const next = { x: rawX / length, z: rawZ / length };
    setThumb(next);
    onMove(next);
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    setThumb(center);
    onMove(center);
  }

  return (
    <button type="button" className="city-joystick" aria-label="Move. Drag the joystick or use WASD."
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null) return;
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      <span style={{ transform: "translate(" + thumb.x * 84 + "%," + thumb.z * 84 + "%)" }} />
    </button>
  );
}
