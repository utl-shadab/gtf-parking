import type { Level, Obstacle } from "../../types/game.ts";
import { trafficLayouts } from "./traffic-layouts.ts";

const east = -Math.PI / 2;
const south = Math.PI;

function barrier(x: number, z: number, yaw = 0): Obstacle {
  return { kind: "barrier", x, z, yaw };
}

const cars: Obstacle[] = [
  { kind: "car", x: -9.7, z: -6.7, yaw: Math.PI, color: "#ce5247", style: "utility" },
  { kind: "car", x: -7, z: -6.7, yaw: 0, color: "#e9b94e", style: "hatch" },
  { kind: "car", x: -1.5, z: -6.7, yaw: Math.PI, color: "#d7dbdc", style: "utility" },
  { kind: "car", x: 1.3, z: -6.7, yaw: 0, color: "#254e6d", style: "sedan" },
  { kind: "car", x: 9.7, z: -6.7, yaw: Math.PI, color: "#9ca7b7", style: "hatch" },
  { kind: "car", x: -9.7, z: 6.9, yaw: 0, color: "#276e70", style: "utility" },
  { kind: "car", x: -7, z: 6.9, yaw: Math.PI, color: "#bb7486", style: "hatch" },
  { kind: "car", x: 1.3, z: 6.9, yaw: 0, color: "#313c52", style: "utility" },
  { kind: "car", x: 6.9, z: 6.9, yaw: 0, color: "#d4d8dc", style: "sedan" },
  { kind: "car", x: 9.7, z: 6.9, yaw: Math.PI, color: "#b55b39", style: "hatch" },
];

const levels: Level[] = [
  {
    id: "alignment",
    name: "First alignment",
    objective: "Drive into the highlighted bay and stop inside the lines.",
    start: { x: -4.25, z: 4.8, yaw: 0 },
    bay: { id: "A03", x: -4.25, z: -6.7, yaw: 0, width: 2.65, length: 4.8 },
    obstacles: cars,
  },
  {
    id: "reverse",
    name: "Reverse entry",
    objective: "Practice backing into the marked space and stop inside the lines.",
    start: { x: 4.1, z: -0.7, yaw: 0 },
    bay: { id: "B06", x: 4.1, z: 6.9, yaw: 0, width: 2.6, length: 4.8 },
    obstacles: cars,
  },
  {
    id: "corner",
    name: "Corner approach",
    objective: "Turn through the aisle and park between the barriers.",
    start: { x: -8, z: 0.4, yaw: -Math.PI / 2 },
    bay: { id: "A07", x: 6.9, z: -6.7, yaw: 0, width: 2.54, length: 4.75 },
    obstacles: [
      ...cars,
      { kind: "barrier", x: 5.32, z: -6.7, yaw: 0 },
      { kind: "barrier", x: 8.48, z: -6.7, yaw: 0 },
      { kind: "barrier", x: -0.6, z: 2.8, yaw: Math.PI / 2 },
    ],
  },
  {
    id: "slalom",
    name: "Narrow passage",
    objective: "Thread the staggered barriers, then turn into the far bay.",
    start: { x: -10.45, z: -1.6, yaw: east },
    bay: { id: "B08", x: 9.7, z: 6.9, yaw: 0, width: 2.5, length: 4.7 },
    obstacles: [
      ...cars.slice(0, -1),
      barrier(-5.8, 0.9), barrier(1.9, -1.4),
    ],
  },
  {
    id: "reverse-corner",
    name: "Reverse corner",
    objective: "Swing wide, then back around the corner into the bay.",
    start: { x: 7.1, z: 0.9, yaw: east },
    bay: { id: "A05", x: 1.3, z: -6.7, yaw: south, width: 2.44, length: 4.65 },
    obstacles: [
      ...cars.filter((car) => car.x !== 1.3 || car.z > 0),
      barrier(2.78, -6.7), barrier(7.2, -2.6, east),
    ],
  },
  {
    id: "diagonal",
    name: "Angled approach",
    objective: "Clear the dividers and line up with the diagonal bay.",
    start: { x: -9.3, z: 2.65, yaw: east },
    bay: { id: "C01", x: 8.6, z: -0.4, yaw: -Math.PI / 4, width: 2.38, length: 4.62 },
    obstacles: [
      ...cars, barrier(-5, 0.95, east), barrier(-0.3, -1.25, east),
      barrier(9.72, 0.72, -Math.PI / 4), barrier(7.48, -1.52, -Math.PI / 4),
    ],
  },
  {
    id: "parallel",
    name: "Parallel pocket",
    objective: "Reverse between the two parked cars and finish parallel to the divider.",
    start: { x: 4.1, z: -0.15, yaw: east },
    bay: { id: "C02", x: -1.4, z: -2.7, yaw: east, width: 2.34, length: 5.4 },
    obstacles: [
      ...cars,
      { kind: "car", x: -6.3, z: -2.7, yaw: east, color: "#d0a14c", style: "sedan" },
      { kind: "car", x: 4.5, z: -2.7, yaw: east, color: "#427380", style: "utility" },
      barrier(-1.4, -4.32, east),
    ],
  },
  {
    id: "offset",
    name: "Offset gates",
    objective: "Clear both offset gates and stop inside the marked bay.",
    start: { x: -10.8, z: 2.2, yaw: east },
    bay: { id: "B07", x: 6.9, z: 6.9, yaw: 0, width: 2.28, length: 4.52 },
    obstacles: [
      ...cars.filter((car) => car.x !== 6.9 || car.z < 0),
      barrier(-6.6, -0.2), barrier(-6.6, -2.7),
      barrier(-0.3, 1.4), barrier(-0.3, 3.9),
      barrier(8.6, 6.55),
    ],
  },
  {
    id: "switchback",
    name: "Switchback",
    objective: "Pass the divider, turn back up the return lane and park at its end.",
    start: { x: -9.65, z: 3.9, yaw: east },
    bay: { id: "C03", x: -3.8, z: -2.7, yaw: Math.PI / 2, width: 2.2, length: 4.46 },
    obstacles: [
      ...cars,
      barrier(-9.75, -0.25, east), barrier(-7.4, -0.25, east),
      barrier(-5.05, -0.25, east), barrier(-2.7, -0.25, east), barrier(-0.35, -0.25, east),
      barrier(-7.95, -2.65), barrier(-3, 5.35, east), barrier(1.3, 5.35, east),
    ],
  },
  {
    id: "master",
    name: "Precision test",
    objective: "Work through the chicane and stop fully within the tightest bay.",
    start: { x: 10.6, z: 1.9, yaw: Math.PI / 2 },
    bay: { id: "A02", x: -7, z: -6.7, yaw: south, width: 2.14, length: 4.35 },
    obstacles: [
      ...cars.filter((car) => car.x !== -7 || car.z > 0),
      { kind: "car", x: -4.25, z: -6.7, yaw: 0, color: "#546975", style: "sedan" },
      barrier(6.1, -0.55), barrier(6.1, -2.9),
      barrier(-1.15, 1.25), barrier(-1.15, 3.6),
      barrier(-5.55, -7.3), barrier(-8.57, -7.3), barrier(-9, 3.8, east),
    ],
  },
];

export function getLevels(): Level[] {
  return levels.map((level, index) => {
    const { lot, extra } = trafficLayouts[index];
    return { ...level, lot, obstacles: [...level.obstacles, ...extra.map((obstacle) => ({ ...obstacle, campaignExtra: true as const }))] };
  });
}
