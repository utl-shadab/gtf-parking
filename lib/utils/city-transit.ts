import type { Pose } from "@/types/game";
import { junctions, trafficSignal } from "./city-rules.ts";

type RoutePoint = readonly [x: number, z: number, stop?: string];

export function createCityRoute(points: readonly RoutePoint[]) {
  let length = 0;
  const stops: { name: string; at: number }[] = [];
  const segments = points.map(([x, z, stop], index) => {
    const [endX, endZ] = points[(index + 1) % points.length];
    const dx = endX - x;
    const dz = endZ - z;
    const size = Math.hypot(dx, dz);
    const start = length;
    length += size;
    if (stop) stops.push({ name: stop, at: start });
    return { x, z, dx, dz, size, start, yaw: Math.atan2(-dx, -dz) };
  });
  const signals = segments.flatMap((segment) => junctions.flatMap((junction, index) => {
    const axis = Math.abs(segment.dx) > Math.abs(segment.dz) ? "x" : "z";
    const lateral = axis === "x" ? segment.z - junction.z : segment.x - junction.x;
    if (Math.abs(lateral) > 6.7) return [];
    const direction = Math.sign(axis === "x" ? segment.dx : segment.dz);
    const position = axis === "x" ? junction.x - segment.x : junction.z - segment.z;
    const at = position * direction - 10;
    if (at <= 0 || at >= segment.size) return [];
    return [{ at: segment.start + at, axis, index }] satisfies { at: number; axis: "x" | "z"; index: number }[];
  }));
  const wrap = (distance: number) => ((distance % length) + length) % length;
  return {
    length,
    stops,
    wrap,
    sample(distance: number, pose: Pose) {
      const at = wrap(distance);
      const segment = segments.find(({ start, size }) => at < start + size) ?? segments[0];
      const ratio = (at - segment.start) / segment.size;
      pose.x = segment.x + ratio * segment.dx;
      pose.z = segment.z + ratio * segment.dz;
      pose.yaw = segment.yaw;
    },
    redDistance(distance: number, time: number) {
      let limit = Infinity;
      for (const { at, axis, index } of signals) {
        if (trafficSignal(time, axis, index * 4) !== "green") limit = Math.min(limit, wrap(at - distance));
      }
      return limit;
    },
  };
}

export const busRoute = createCityRoute([
  [18, 35, "Juniper Park"], [103, 35], [103, -33], [-77, -33, "West Market"],
  [-103, -33], [-103, 95], [78, 95, "Drift Beach"], [95, 95], [95, 87], [-37, 87], [-37, 35],
]);

export const trafficRoutes = [
  createCityRoute([[-103, 87], [-103, -93], [103, -93], [103, 87]]),
  createCityRoute([[-37, 87], [-37, -33], [37, -33], [37, 87]]),
  createCityRoute([[-95, 35], [-95, -85], [29, -85], [29, 35]]),
];

export function nextTransitStop(route: typeof busRoute, distance: number) {
  return route.stops.find(({ at }) => at > distance + 0.05) ?? route.stops[0];
}
