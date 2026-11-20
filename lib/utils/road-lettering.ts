import type { Level, Pose } from "../../types/game.ts";
import { CAR_LENGTH, LOT_LENGTH, LOT_WIDTH, MAX_PLAYER_WIDTH, STALL_SPACING, obstacleSize, parkingRow } from "./driving.ts";

interface PaintedArea {
  x: number;
  z: number;
  width: number;
  length: number;
}

function groundBounds({ x, z, yaw }: Pose, { width, length }: Pick<PaintedArea, "width" | "length">): PaintedArea {
  const across = Math.abs(Math.cos(yaw));
  const along = Math.abs(Math.sin(yaw));
  return { x, z, width: across * width + along * length, length: along * width + across * length };
}

function overlaps(a: PaintedArea, b: PaintedArea, clearance: number) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + clearance
    && Math.abs(a.z - b.z) < (a.length + b.length) / 2 + clearance;
}

export function findRoadLettering(level: Level): PaintedArea[] {
  const halfWidth = (level.lot?.width ?? LOT_WIDTH) / 2;
  const halfLength = (level.lot?.length ?? LOT_LENGTH) / 2;
  const row = parkingRow(halfWidth * 2);
  const rowWidth = row.count * STALL_SPACING;
  const occupied = [
    ...level.obstacles.map((obstacle) => groundBounds(obstacle, obstacleSize(obstacle))),
    ...[level.bay, ...(level.stops ?? [])].map((bay) => groundBounds(bay, bay)),
    groundBounds(level.start, { width: MAX_PLAYER_WIDTH, length: CAR_LENGTH }),
    { x: -halfWidth + 2.4, z: 0, width: 2.6, length: 2.9 },
    ...[-6.7, 6.9].map((z) => ({ x: row.start + rowWidth / 2, z, width: rowWidth, length: 4.8 })),
  ];
  const spots: PaintedArea[] = [];
  for (let x = -halfWidth + 0.75; x <= halfWidth - 0.75; x += 0.55) {
    for (let z = -halfLength + 0.75; z <= halfLength - 0.75; z += 0.48) {
      for (const width of [12.8, 11.2, 9.6, 8, 6.4, 5.6, 4.8]) {
        const candidate = { x, z, width, length: width * 2.8 / 12.8 };
        if (Math.abs(x) + width / 2 > halfWidth - 0.65 || Math.abs(z) + candidate.length / 2 > halfLength - 0.65) continue;
        if (occupied.some((area) => overlaps(area, candidate, 0.4))) continue;
        spots.push(candidate);
        break;
      }
    }
  }
  const score = (spot: PaintedArea) => spot.width * 1.15 - Math.abs(spot.x + 1.65) * 0.46 - Math.abs(spot.z + 2.22) * 1.1;
  spots.sort((a, b) => score(b) - score(a));
  const first = spots[0];
  if (!first) return [];
  const second = spots.find((spot) => spot.width >= 5.6 && !overlaps(first, spot, 2.5)
    && (Math.abs(first.x - spot.x) >= 8 || Math.abs(first.z - spot.z) >= 5.5));
  return second ? [first, second] : [first];
}
