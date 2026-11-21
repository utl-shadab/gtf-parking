export const avenues = [-99, -33, 33, 99];
export const streets = [-89, -29, 31, 91];
export const junctions = avenues.slice(1, -1).flatMap((x) => streets.slice(1, -1).map((z) => ({ x, z })));
export const cityBounds = { left: -127, right: 127, top: -187, bottom: 179 };
export const junctionRadius = 8;

type Axis = "x" | "z";
export type Signal = "green" | "amber" | "red";

export function cityFootMotion(dx: number, dz: number, yaw: number, dt: number) {
  const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
  if (speed < 0.08) return { speed, yaw };
  const turn = Math.atan2(-dx, -dz) - yaw;
  const heading = yaw + Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-19 * dt));
  return { speed, yaw: heading };
}

export function trafficSignal(seconds: number, axis: Axis, offset = 0): Signal {
  const phase = (seconds + offset) % 30;
  const start = axis === "z" ? 0 : 15;
  if (phase >= start && phase < start + 11) return "green";
  if (phase >= start + 11 && phase < start + 14) return "amber";
  return "red";
}

export function crossedRed(fromX: number, fromZ: number, x: number, z: number, seconds: number) {
  const axis = Math.abs(x - fromX) > Math.abs(z - fromZ) ? "x" : "z";
  return junctions.some((junction, index) => {
    if (trafficSignal(seconds, axis, index * 4) !== "red") return false;
    const crossAxis = axis === "x" ? "z" : "x";
    const lateral = crossAxis === "x" ? x : z;
    if (Math.abs(lateral - junction[crossAxis]) > 6.8) return false;
    const previous = (axis === "x" ? fromX : fromZ) - junction[axis];
    const current = (axis === "x" ? x : z) - junction[axis];
    return Math.abs(previous) >= junctionRadius && Math.abs(current) < junctionRadius;
  });
}

export function insideCity(x: number, z: number) {
  return x > cityBounds.left && x < cityBounds.right && z > cityBounds.top && z < cityBounds.bottom;
}

export function isDeepWater(x: number, z: number) {
  const shore = x < -58 ? 127 : 130 - 2.5 * (Math.sin(x / 20) + 0.31 * Math.cos(x / 8));
  return z > shore && !(x > 66 && x < 72 && z < 161.5)
    && !(x > 62.7 && x < 75.3 && z > 157.6 && z < 164.75);
}
