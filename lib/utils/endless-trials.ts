import type { Gear, Level, Obstacle, ParkingBay, Pose } from "../../types/game.ts";
import { advanceDrive, createDriveState, LOT_LENGTH, LOT_WIDTH, STALL_SPACING, obstaclesOverlap, parkingRow } from "./driving.ts";

type Route = readonly (readonly [gear: Gear, steering: -1 | 0 | 1, frames: number])[];

export const endlessRoutes = {
  parallel: [["R", 0, 12], ["R", -1, 130], ["R", 0, 24], ["R", 1, 106], ["P", 0, 140]],
  offset: [
    ["D", 0, 177], ["D", -1, 87], ["D", 1, 87], ["D", 0, 75],
    ["D", -1, 118], ["P", 0, 48], ["R", 0, 527], ["P", 0, 140],
  ],
  switchback: [["D", 0, 347], ["D", -1, 233], ["D", 0, 136], ["P", 0, 140]],
  master: [
    ["D", -1, 108], ["D", 1, 36], ["D", 0, 36], ["D", 1, 72], ["D", 0, 36], ["D", 1, 36],
    ["D", -1, 108], ["D", 1, 36], ["D", 0, 72], ["D", -1, 36], ["P", 0, 36],
    ["R", 0, 36], ["R", 1, 147], ["R", -1, 14], ["R", 1, 66], ["P", 0, 140],
  ],
} as const satisfies Record<string, Route>;

const layouts = ["offset", "switchback", "parallel", "master"] as const;
const finishes = ["#3a6370", "#b77636", "#a3a6aa", "#943f4b", "#6a7862"];

export function replayTrial(level: Level, route: Route, clearance = 0) {
  const car = createDriveState(level.start);
  for (const [gear, steering, frames] of route) {
    for (let tick = 0; tick < frames && !car.result; tick++) {
      advanceDrive(car, { gear, steering, throttle: gear !== "P", brake: gear === "P" }, level, 1 / 120, clearance, "both");
    }
  }
  return car;
}

function hasRoom(level: Level, route: Route) {
  const inset = (bay: ParkingBay) => ({ ...bay, width: bay.width - 0.1, length: bay.length - 0.14 });
  const checked = { ...level, bay: inset(level.bay), stops: level.stops?.map(inset) };
  return replayTrial(checked, route, 0.065).result === "parked";
}

function seededRandom(trial: number) {
  let seed = Math.imul(trial ^ Math.floor(trial / 2 ** 32), 0x9e3779b1) >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function reflect<T extends Pose>(pose: T, sx: number, sz: number): T {
  return {
    ...pose, x: pose.x * sx, z: sz < 0 ? Math.round((0.2 - pose.z) * 1000) / 1000 : pose.z,
    yaw: Math.atan2(Math.sin(pose.yaw) * sx, Math.cos(pose.yaw) * sz),
  };
}

function fromOrigin(pose: Pose, origin: Pose): Pose {
  const sin = Math.sin(origin.yaw);
  const cos = Math.cos(origin.yaw);
  return {
    x: origin.x + pose.x * cos + pose.z * sin,
    z: origin.z - pose.x * sin + pose.z * cos,
    yaw: origin.yaw + pose.yaw,
  };
}

function leadIn(template: Level, destination: Pose, gear: Gear, count: number, pressure: number, turn: number) {
  const emptyLot: Level = {
    ...template, start: { x: 0, z: 0, yaw: 0 }, bay: { ...template.bay, width: 0, length: 0 },
    lot: { width: 250, length: 250 }, obstacles: [],
  };
  const moves: Array<Route[number]> = [];
  const parkLocations: Pose[] = [];
  for (let index = 0; index < count; index++) {
    if (turn > 0) {
      const side = index % 2 === 0 ? 1 : -1;
      const ticks = gear === "D" ? turn : Math.round(turn * 1.55);
      const total = gear === "D" ? 180 : 245;
      moves.push([gear, 0, total - ticks * 2 - 23], [gear, side, ticks], [gear, side === 1 ? -1 : 1, ticks], [gear, 0, 23]);
    } else {
      moves.push([gear, 0, gear === "D" ? 160 : 223]);
    }
    moves.push(["P", 0, 140]);
    parkLocations.push(replayTrial(emptyLot, moves));
  }
  moves.push([gear, 0, 110 + Math.round(112 * pressure)], ["P", 0, 75]);
  const final = replayTrial(emptyLot, moves);
  const yaw = destination.yaw - final.yaw;
  const offset = fromOrigin(final, { x: 0, z: 0, yaw });
  const start = { x: destination.x - offset.x, z: destination.z - offset.z, yaw };
  const stops = parkLocations.map((pose, index) => ({
    ...fromOrigin(pose, start),
    id: `E0${index + 1}`, width: 2.28 - 0.17 * pressure, length: 4.35 - 0.15 * pressure,
  }));
  return { start, stops, moves };
}

export function createEndlessTrial(catalog: Level[], number: number): { level: Level; route: Route } {
  const depth = number - catalog.length;
  const pressure = depth / (depth + 32);
  const random = seededRandom(number);
  const preferred = (depth - 1 + Math.floor((depth - 1) / layouts.length)) % layouts.length;
  const sx = random() < 0.5 ? -1 : 1;
  const sz = random() < 0.5 ? -1 : 1;
  const intermediateStops = 1 + Number(depth >= 10) + Number(depth >= 30);
  const lot = { width: LOT_WIDTH + 5 + 19 * pressure + 10 * intermediateStops, length: LOT_LENGTH + 2 + 10 * pressure };
  const row = parkingRow(lot.width);
  const turn = Math.round(16 + 30 * pressure);
  const difficulties = depth < 5 ? [0] : [turn, Math.round(turn * 0.65), 0];

  for (const slalom of difficulties) for (let attempt = 0; attempt < layouts.length; attempt++) {
    const key = layouts[(preferred + attempt) % layouts.length];
    const template = catalog.find((level) => level.id === key);
    if (!template) continue;
    const gear = endlessRoutes[key][0][0];
    const { start, stops, moves } = leadIn(template, reflect(template.start, sx, sz), gear, intermediateStops, pressure, slalom);
    const bay = reflect(template.bay, sx, sz);
    if (bay.id[0] === "A" || bay.id[0] === "B") {
      const stall = Math.floor((bay.x - row.start) / STALL_SPACING) + 1;
      bay.id = `${bay.z < 0 ? "A" : "B"}${String(stall).padStart(2, "0")}`;
    }
    const route: Route = [...moves, ...endlessRoutes[key].map(([gear, steering, frames]) => [
      gear, (steering * sx * sz) as -1 | 0 | 1, frames,
    ] as const)];
    let level: Level = {
      ...template,
      id: `endless-${number}`,
      name: key === "master" ? "Precision chicane" : template.name,
      lot,
      start,
      stops,
      bay: {
        ...bay,
        width: 2.14 - 0.11 * pressure,
        length: (key === "parallel" ? 4.75 : 4.35) - 0.15 * pressure,
      },
      obstacles: template.obstacles.filter((obstacle) => !obstacle.campaignExtra).map((obstacle) => reflect(obstacle, sx, sz)),
    };
    if (!hasRoom(level, route)) continue;

    const shift = (random() - 0.5) * 0.24;
    const shifted = { ...level, start: { ...level.start, x: level.start.x + shift } };
    if (hasRoom(shifted, route)) level = shifted;

    const dividers = level.obstacles.flatMap((item, index) => item.kind === "barrier" ? [index] : []);
    for (const index of dividers) {
      const original = level.obstacles[index];
      const travel = 0.22 + 0.66 * pressure;
      const offset = (random() - 0.5) * travel;
      const moved = { ...original, x: original.x + Math.cos(original.yaw) * offset, z: original.z - Math.sin(original.yaw) * offset };
      if (level.obstacles.some((item, i) => i !== index && obstaclesOverlap(moved, item))) continue;
      const candidate = { ...level, obstacles: level.obstacles.map((item, i) => i === index ? moved : item) };
      if (hasRoom(candidate, route)) level = candidate;
    }

    for (const [index, stop] of stops.entries()) {
      const from = index === 0 ? level.start : stops[index - 1];
      const portion = slalom ? 0.72 : 0.5;
      const gateCenter = { x: from.x + (stop.x - from.x) * portion, z: from.z + (stop.z - from.z) * portion };
      const gap = 2.78 - 0.48 * pressure - index * 0.035;
      const gate: Obstacle[] = [-1, 1].map((side) => ({
        kind: "barrier", yaw: stop.yaw,
        x: gateCenter.x + Math.cos(stop.yaw) * side * (gap + 0.54) / 2,
        z: gateCenter.z - Math.sin(stop.yaw) * side * (gap + 0.54) / 2,
      }));
      const gated = { ...level, obstacles: [...level.obstacles, ...gate] };
      if (gate.every((rail) => level.obstacles.every((obstacle) => !obstaclesOverlap(rail, obstacle))) && hasRoom(gated, route)) level = gated;
    }

    for (const extra of template.obstacles) {
      if (!extra.campaignExtra) continue;
      const obstacle = reflect(extra, sx, sz);
      if (level.obstacles.some((existing) => obstaclesOverlap(existing, obstacle))) continue;
      const candidate = { ...level, obstacles: [...level.obstacles, obstacle] };
      if (hasRoom(candidate, route)) level = candidate;
    }

    const slots = [-6.7, 6.9].flatMap((z) => Array.from({ length: row.count }, (_, i) => ({ x: row.start + (i + 0.5) * STALL_SPACING, z, order: random() })));
    slots.sort((a, b) => a.order - b.order);
    const limit = 4 + Math.floor(pressure * 6);
    let added = 0;
    for (const { x, z } of slots) {
      if (added >= limit) break;
      if (Math.abs(level.bay.x - x) < 2.4 && Math.abs(level.bay.z - z) < 4.2) continue;
      if (level.obstacles.some((obstacle) => Math.abs(obstacle.x - x) < 2.5 && Math.abs(obstacle.z - z) < 4.2)) continue;
      const car: Obstacle = { kind: "car", x, z, yaw: random() < 0.5 ? 0 : Math.PI, style: random() < 0.5 ? "hatch" : "utility", color: finishes[Math.floor(random() * finishes.length)] };
      if (level.obstacles.some((obstacle) => obstaclesOverlap(car, obstacle))) continue;
      const candidate = { ...level, obstacles: [...level.obstacles, car] };
      if (hasRoom(candidate, route)) {
        level = candidate;
        added++;
      }
    }
    return { level, route };
  }
  throw new Error(`No verified layout for trial ${number}`);
}
