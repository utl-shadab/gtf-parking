import type { Action, Gear } from "@/types/game";

export const driveStep = 1 / 120;
export const movementKeys = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export interface DriveControlsState {
  keys: Set<string>;
  buttons: Set<Action>;
  wheel: number | null;
}

export function readDriveInput({ keys, buttons, wheel }: DriveControlsState, gear: Gear) {
  const left = keys.has("KeyA") || keys.has("ArrowLeft") || buttons.has("left");
  const right = keys.has("KeyD") || keys.has("ArrowRight") || buttons.has("right");
  const forward = keys.has("KeyW") || keys.has("ArrowUp");
  const backward = keys.has("KeyS") || keys.has("ArrowDown");
  return {
    forward,
    backward,
    steering: wheel ?? Number(right) - Number(left),
    throttle: forward || backward || buttons.has("pedal"),
    brake: keys.has("Space") || buttons.has("brake"),
    gear: backward && gear === "D" ? "R" : gear,
  };
}
