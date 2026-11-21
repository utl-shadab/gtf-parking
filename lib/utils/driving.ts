import type { Gear, Level, Obstacle, Pose } from "../../types/game.ts";
import type { VehicleId } from "../../types/vehicle.ts";
import { rosterFootprints } from "./roster-footprints.ts";

export const CAR_WIDTH = 1.72;
export const CAR_LENGTH = 3.55;
export const MAX_PLAYER_WIDTH = 1.9;
export const LOT_WIDTH = 27;
export const LOT_LENGTH = 21.6;
export const BAY_LINE_WIDTH = 0.095;
export const STALL_SPACING = 2.77;

export function parkingRow(width: number) {
  const extra = Math.max(0, Math.floor((width / 2 - 11.085 - 0.8) / STALL_SPACING));
  return { start: -11.085 - extra * STALL_SPACING, count: 8 + extra * 2 };
}

const PARK_HOLD = 0.65;
type GroundPoint = Pick<Pose, "x" | "z">;
type Outline = readonly (readonly [x: number, z: number])[];

const rectangle: Outline = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
// Ground projections of the player bodies, bumpers and tires, normalized to the parking envelope.
const vehicleOutlines: Record<"thar" | "gt", Outline> = {
  thar: [[-0.552, -0.283], [-0.539, -0.332], [-0.532, -0.342], [-0.244, -0.416], [0.246, -0.416],
    [0.532, -0.342], [0.539, -0.332], [0.552, -0.283], [0.552, 0.281], [0.539, 0.33], [0.532, 0.34],
    [0.304, 0.386], [0.098, 0.415], [-0.098, 0.415], [-0.304, 0.386], [-0.532, 0.34], [-0.539, 0.33], [-0.552, 0.281]],
  gt: [[-0.433, -0.342], [-0.423, -0.401], [-0.408, -0.435], [-0.389, -0.46], [-0.35, -0.472], [-0.281, -0.485],
    [-0.153, -0.497], [0, -0.5], [0.153, -0.497], [0.281, -0.485], [0.35, -0.472], [0.389, -0.46], [0.408, -0.435],
    [0.423, -0.401], [0.433, -0.342], [0.439, 0.324], [0.437, 0.362], [0.414, 0.447], [0.405, 0.463],
    [0.368, 0.479], [0.299, 0.5], [-0.299, 0.5], [-0.368, 0.479], [-0.405, 0.463], [-0.414, 0.447], [-0.437, 0.362], [-0.439, 0.324]],
};
// Every selectable vehicle fits inside the envelope verified by the course generator.
export const validationOutline: Outline = [
  [-0.552, -0.283], [-0.539, -0.332], [-0.532, -0.342], [-0.389, -0.46], [-0.35, -0.472], [-0.281, -0.485],
  [-0.153, -0.497], [0, -0.5], [0.153, -0.497], [0.281, -0.485], [0.35, -0.472], [0.389, -0.46], [0.532, -0.342],
  [0.539, -0.332], [0.552, -0.283], [0.552, 0.281], [0.539, 0.33], [0.532, 0.34], [0.405, 0.463],
  [0.368, 0.479], [0.299, 0.5], [-0.299, 0.5], [-0.368, 0.479], [-0.405, 0.463], [-0.532, 0.34], [-0.539, 0.33], [-0.552, 0.281],
];
const carOutlines: Record<NonNullable<Obstacle["style"]>, Outline> = {
  hatch: [[-0.434, -0.419], [-0.372, -0.485], [0, -0.5], [0.372, -0.485], [0.434, -0.419],
    [0.44, 0.416], [0.404, 0.488], [0, 0.5], [-0.404, 0.488], [-0.44, 0.416]],
  utility: [[-0.428, -0.429], [-0.38, -0.487], [0, -0.5], [0.38, -0.487], [0.428, -0.429],
    [0.436, 0.425], [0.405, 0.493], [-0.405, 0.493], [-0.436, 0.425]],
  sedan: [[-0.438, -0.314], [-0.41, -0.457], [-0.374, -0.481], [-0.15, -0.496], [0.15, -0.496],
    [0.374, -0.481], [0.41, -0.457], [0.438, -0.314], [0.433, 0.428], [0.333, 0.5],
    [-0.333, 0.5], [-0.433, 0.428]],
};

export interface DriveInput {
  steering: number;
  throttle: boolean;
  brake: boolean;
  gear: Gear;
}

export interface DriveState extends Pose {
  speed: number;
  steering: number;
  elapsed: number;
  impact: Obstacle["kind"] | "wall" | null;
  impactAt: GroundPoint | null;
  parkedFor: number;
  stopIndex: number;
  aligned: boolean;
  result: "parked" | "failed" | null;
}

interface Footprint extends Pose {
  width: number;
  length: number;
}

export function obstacleSize(obstacle: Obstacle): { width: number; length: number } {
  if (obstacle.kind === "barrier") return { width: 0.54, length: 2.35 };
  return obstacle.style === "utility" ? { width: 1.83, length: 3.68 }
    : obstacle.style === "sedan" ? { width: 1.76, length: 3.85 }
    : { width: CAR_WIDTH, length: CAR_LENGTH };
}

export function createDriveState(start: Pose): DriveState {
  return { ...start, speed: 0, steering: 0, elapsed: 0, impact: null, impactAt: null, parkedFor: 0, stopIndex: 0, aligned: false, result: null };
}

export function activeBay(level: Level, stopIndex: number) {
  return level.stops?.[stopIndex] ?? level.bay;
}

function footprint({ x, z, yaw, width, length }: Footprint, outline = rectangle) {
  const cx = Math.cos(yaw);
  const sx = Math.sin(yaw);
  return outline.map(([side, end]) => ({
    x: x + side * width * cx + end * length * sx,
    z: z - side * width * sx + end * length * cx,
  }));
}

function edgeDistance(start: GroundPoint, end: GroundPoint, point: GroundPoint) {
  return (end.x - start.x) * (point.z - start.z) - (end.z - start.z) * (point.x - start.x);
}

function separated(a: GroundPoint[], b: GroundPoint[]) {
  return a.some((start, index) => b.every((point) => edgeDistance(start, a[(index + 1) % a.length], point) <= 0));
}

function obstacleOutline(obstacle: Obstacle) {
  return footprint({ ...obstacle, ...obstacleSize(obstacle) }, obstacle.kind === "barrier" ? rectangle : carOutlines[obstacle.style ?? "hatch"]);
}

export function obstaclesOverlap(first: Obstacle, second: Obstacle) {
  if (Math.abs(first.x - second.x) > 4 || Math.abs(first.z - second.z) > 4) return false;
  const a = obstacleOutline(first);
  const b = obstacleOutline(second);
  return !separated(a, b) && !separated(b, a);
}

function obstacleHit(car: Footprint, outline: GroundPoint[], obstacles: Obstacle[]) {
  for (const obstacle of obstacles) {
    if (Math.abs(obstacle.x - car.x) > 4 || Math.abs(obstacle.z - car.z) > 4) continue;
    const shape = obstacleOutline(obstacle);
    if (!separated(outline, shape) && !separated(shape, outline)) return { kind: obstacle.kind, shape };
  }
}

function average(points: GroundPoint[]): GroundPoint {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, z: total.z + point.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
}

function obstacleImpact(overlap: GroundPoint[], obstacle: GroundPoint[]): GroundPoint {
  for (const [index, edgeStart] of obstacle.entries()) {
    const edgeEnd = obstacle[(index + 1) % obstacle.length];
    const clipped: GroundPoint[] = [];
    for (const [i, end] of overlap.entries()) {
      const start = overlap[(i + overlap.length - 1) % overlap.length];
      const a = edgeDistance(edgeStart, edgeEnd, start);
      const b = edgeDistance(edgeStart, edgeEnd, end);
      if ((a < 0) !== (b < 0)) {
        const t = a / (a - b);
        clipped.push({ x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t });
      }
      if (b >= 0) clipped.push(end);
    }
    overlap = clipped;
  }
  return average(overlap.length ? overlap : obstacle);
}

function fitsBay(car: Footprint, bay: Level["bay"], outline: Outline) {
  if (Math.abs(Math.cos(car.yaw - bay.yaw)) < Math.cos(12 * Math.PI / 180)) return false;
  const sin = Math.sin(bay.yaw);
  const cos = Math.cos(bay.yaw);
  return footprint(car, outline).every(({ x, z }) => {
    const dx = x - bay.x;
    const dz = z - bay.z;
    return Math.abs(dx * cos - dz * sin) <= (bay.width + BAY_LINE_WIDTH) / 2
      && Math.abs(dx * sin + dz * cos) <= (bay.length + BAY_LINE_WIDTH) / 2;
  });
}

export interface FreeDriveArea {
  blocked: (x: number, z: number) => boolean;
  speedLimit: number;
  body?: { width: number; length: number };
}

export function advanceDrive(state: DriveState, input: DriveInput, level: Level | FreeDriveArea, dt: number, clearance = 0, vehicle: VehicleId | "both" = "gt") {
  if (state.result) return;
  state.elapsed += dt;
  const bodyOutline = vehicle === "both" ? validationOutline
    : vehicle === "thar" || vehicle === "gt" ? vehicleOutlines[vehicle] : rosterFootprints[vehicle].outline;

  const freeDrive = "blocked" in level ? level : undefined;
  const topSpeed = input.gear === "D" ? freeDrive?.speedLimit ?? 5.35 : input.gear === "R" ? -3.1 : 0;
  const target = input.throttle && !input.brake ? topSpeed : 0;
  const rate = input.brake || input.gear === "P" ? 13.5
    : target === 0 ? 2.7
    : state.speed * target < 0 ? 8.4 : 4.3;
  state.speed += Math.sign(target - state.speed) * Math.min(Math.abs(target - state.speed), rate * dt);
  state.steering += (input.steering - state.steering) * (1 - Math.exp(-14 * dt));

  const yaw = state.yaw - (state.speed / 2.25) * Math.tan(state.steering * 0.6) * dt;
  const direction = (yaw + state.yaw) / 2;
  const car = {
    x: state.x - Math.sin(direction) * state.speed * dt,
    z: state.z - Math.cos(direction) * state.speed * dt,
    yaw,
    width: CAR_WIDTH,
    length: CAR_LENGTH,
  };

  const moving = Math.abs(state.speed) > 0.001;
  if ("blocked" in level) {
    if (!moving) return;
    if (footprint({ ...car, ...level.body }, level.body ? rectangle : bodyOutline).some(({ x, z }) => level.blocked(x, z))) {
      state.speed = 0;
      return;
    }
    state.x = car.x;
    state.z = car.z;
    state.yaw = yaw;
    return;
  }
  if (moving) {
    const halfWidth = (level.lot?.width ?? LOT_WIDTH) / 2;
    const halfLength = (level.lot?.length ?? LOT_LENGTH) / 2;
    const outsideLot = ({ x, z }: GroundPoint) => Math.abs(x) > halfWidth || Math.abs(z) > halfLength;
    const collisionBody = { ...car, width: CAR_WIDTH + 2 * clearance, length: CAR_LENGTH + 2 * clearance };
    let contact = footprint(collisionBody, bodyOutline);
    const crossesWall = contact.some(outsideLot);
    const obstacle = crossesWall ? undefined : obstacleHit(car, contact, level.obstacles);
    if (crossesWall || obstacle) {
      let safe = 0;
      let hit = 1;
      const poseAt = (time: number) => ({
        ...collisionBody,
        x: state.x + (car.x - state.x) * time,
        z: state.z + (car.z - state.z) * time,
        yaw: state.yaw + (car.yaw - state.yaw) * time,
      });
      // Locate contact within the fixed simulation step so the car stops flush with the object.
      for (let i = 0; i < 10; i++) {
        const mid = (safe + hit) / 2;
        const outline = footprint(poseAt(mid), bodyOutline);
        const collides = obstacle ? !separated(outline, obstacle.shape) && !separated(obstacle.shape, outline) : outline.some(outsideLot);
        if (collides) {
          hit = mid;
          contact = outline;
        } else safe = mid;
      }
      const stopped = poseAt(safe);
      state.x = stopped.x;
      state.z = stopped.z;
      state.yaw = stopped.yaw;
      state.impact = obstacle?.kind ?? "wall";
      state.impactAt = obstacle ? obstacleImpact(contact, obstacle.shape) : average(contact.filter(outsideLot).map(({ x, z }) => ({
        x: Math.max(-halfWidth, Math.min(halfWidth, x)),
        z: Math.max(-halfLength, Math.min(halfLength, z)),
      })));
      state.speed = 0;
      state.parkedFor = 0;
      state.aligned = false;
      state.result = "failed";
      return;
    }
    state.x = car.x;
    state.z = car.z;
    state.yaw = yaw;
  }

  state.aligned = fitsBay({ ...state, width: CAR_WIDTH, length: CAR_LENGTH }, activeBay(level, state.stopIndex), bodyOutline);
  state.parkedFor = state.aligned && Math.abs(state.speed) < 0.13 ? state.parkedFor + dt : 0;
  if (state.parkedFor >= PARK_HOLD) {
    if (state.stopIndex < (level.stops?.length ?? 0)) {
      state.stopIndex++;
      state.parkedFor = 0;
      state.aligned = false;
    } else state.result = "parked";
  }
}
