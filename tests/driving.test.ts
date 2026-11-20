import assert from "node:assert/strict";
import test from "node:test";
import type { Gear, Level } from "../types/game.ts";
import { vehicleIds } from "../types/vehicle.ts";
import { getLevels } from "../lib/api/levels.ts";
import { advanceDrive, CAR_LENGTH, createDriveState, LOT_LENGTH, LOT_WIDTH, obstacleSize } from "../lib/utils/driving.ts";
import { createEndlessTrial, endlessRoutes, replayTrial } from "../lib/utils/endless-trials.ts";
import { defaultGarage, readGarage } from "../lib/utils/garage.ts";
import { findRoadLettering } from "../lib/utils/road-lettering.ts";

test("garage restores existing customization and supplies defaults for new cars", () => {
  const saved = {
    active: "gt",
    cars: {
      thar: { id: "thar", color: "#120abc", roof: true },
      gt: { id: "gt", color: "#ff2091", roof: false },
    },
  };
  assert.deepEqual(readGarage(JSON.stringify(saved)), { ...saved, cars: { ...defaultGarage.cars, ...saved.cars } });
  assert.equal(readGarage(JSON.stringify({ ...saved, active: "porsche" })).active, "porsche");
});

test("garage recovers from invalid saved options", () => {
  const raw = JSON.stringify({ active: "spaceship", cars: { thar: { color: "#no-color", roof: "yes" } } });
  assert.deepEqual(readGarage(raw), defaultGarage);
  assert.deepEqual(readGarage("invalid JSON"), defaultGarage);
});

const level: Level = {
  id: "test",
  name: "Test bay",
  objective: "",
  start: { x: 0, z: 0, yaw: 0 },
  bay: { id: "01", x: 0, z: -5, yaw: 0, width: 2.7, length: 4.8 },
  obstacles: [],
};
const input = { steering: 0, throttle: true, brake: false, gear: "D" } as const;
const ticks = 120;

test("drives, brakes, and completes only when stopped in the bay", () => {
  const car = createDriveState(level.start);
  for (let i = 0; i < 167; i++) advanceDrive(car, input, level, 1 / ticks);
  assert.ok(car.z < -3.8 && car.z > -4.5);
  assert.equal(car.result, null);
  for (let i = 0; i < ticks * 2; i++) advanceDrive(car, { ...input, brake: true }, level, 1 / ticks);
  assert.equal(car.result, "parked");
});

test("reverse moves backwards and steering changes heading", () => {
  const car = createDriveState(level.start);
  for (let i = 0; i < ticks; i++) advanceDrive(car, { ...input, gear: "R", steering: -1 }, level, 1 / ticks);
  assert.ok(car.z > 0 && car.yaw < 0);
});

const offsetTrial = getLevels().find((trial) => trial.id === "offset")!;

for (const { name, yaw, distance, accelerationTicks } of [
  { name: "a forward entry", yaw: Math.PI, distance: 3, accelerationTicks: 120 },
  { name: "a forward correction after reversing", yaw: 0, distance: 0.2, accelerationTicks: 44 },
]) {
  test(`B07 completes after ${name} when the car is aligned and stopped`, () => {
    const car = createDriveState({ x: offsetTrial.bay.x, z: offsetTrial.bay.z - distance, yaw });
    if (yaw === 0) {
      for (let i = 0; i < 44; i++) advanceDrive(car, { ...input, gear: "R" }, offsetTrial, 1 / ticks);
    }
    for (let i = 0; i < accelerationTicks; i++) advanceDrive(car, input, offsetTrial, 1 / ticks);
    assert.ok(car.speed > 0);
    for (let i = 0; i < ticks * 2; i++) advanceDrive(car, { ...input, brake: true }, offsetTrial, 1 / ticks);
    assert.equal(car.impact, null);
    assert.equal(car.result, "parked");
  });
}

for (const [gear, yaw, accelerationTicks] of [["D", Math.PI, 120], ["R", 0, 138]] as const) {
  test(`B07 accepts a ${gear === "D" ? "front-in" : "reverse-in"} stop beside the painted line`, () => {
    const { x, z } = offsetTrial.bay;
    const car = createDriveState({ x: x + 0.39, z: z - 2.8, yaw });
    const drive = { ...input, gear };
    for (let i = 0; i < accelerationTicks; i++) advanceDrive(car, drive, offsetTrial, 1 / ticks);
    assert.ok(Math.abs(car.speed) > 1);
    assert.equal(car.result, null);
    for (let i = 0; i < ticks * 2; i++) advanceDrive(car, { ...drive, brake: true }, offsetTrial, 1 / ticks);
    assert.equal(car.impact, null);
    assert.equal(car.result, "parked");
  });
}

test("B07 rejects a stopped car outside the painted bay or angled across it", () => {
  for (const pose of [
    { x: offsetTrial.bay.x + 0.48, z: offsetTrial.bay.z, yaw: 0 },
    { x: offsetTrial.bay.x, z: offsetTrial.bay.z, yaw: Math.PI / 4 },
  ]) {
    const car = createDriveState(pose);
    for (let i = 0; i < ticks; i++) advanceDrive(car, { ...input, throttle: false }, offsetTrial, 1 / ticks);
    assert.equal(car.aligned, false);
    assert.equal(car.result, null);
  }
});

const impactCases: { name: string; contactZ: number; trial: Level }[] = [
  { name: "wall", contactZ: -10.8, trial: { ...level, start: { x: 0, z: -8.9, yaw: 0 } } },
  { name: "parked car", contactZ: -3.625, trial: { ...level, obstacles: [{ kind: "car", x: 0, z: -5.4, yaw: 0 }] } },
  { name: "barrier", contactZ: -3.23, trial: { ...level, obstacles: [{ kind: "barrier", x: 0, z: -3.5, yaw: Math.PI / 2 }] } },
];

for (const { name, contactZ, trial } of impactCases) {
  test(`the first impact with a ${name} ends the trial and freezes motion`, () => {
    const car = createDriveState(trial.start);
    for (let i = 0; i < ticks * 3 && !car.result; i++) advanceDrive(car, input, trial, 1 / ticks);
    assert.equal(car.result, "failed");
    assert.equal(car.speed, 0);
    assert.ok(car.impactAt);
    assert.ok(Math.abs(car.impactAt.x) < 0.2);
    assert.ok(Math.abs(car.impactAt.z - contactZ) < 0.05);
    assert.ok(Math.abs(car.z - CAR_LENGTH * 0.5 - car.impactAt.z) < 0.002);
    const stopped = { ...car };
    advanceDrive(car, { ...input, gear: "R" }, trial, 1 / ticks);
    assert.deepEqual(car, stopped);
  });
}

test("passing a divider outside the car body does not trigger an invisible hit", () => {
  const trial: Level = { ...level, obstacles: [{ kind: "barrier", x: 1.07, z: -3.5, yaw: 0 }] };
  const car = createDriveState(trial.start);
  const thar = createDriveState(trial.start);
  for (let i = 0; i < 250; i++) {
    advanceDrive(car, input, trial, 1 / ticks, 0, "gt");
    advanceDrive(thar, input, trial, 1 / ticks, 0, "thar");
  }
  assert.ok(car.z < -7);
  assert.equal(car.result, null);
  assert.equal(thar.impact, "barrier");
});

type DrivingRoute = readonly (readonly [gear: Gear, steering: -1 | 0 | 1, frames: number])[];

const routes: Record<string, DrivingRoute> = {
  ...endlessRoutes,
  alignment: [["D", 0, 308], ["P", 0, 140]],
  reverse: [["R", 0, 324], ["P", 0, 140]],
  corner: [["D", 0, 325], ["D", -1, 118], ["D", 0, 68], ["P", 0, 140]],
  slalom: [["D", 0, 171], ["D", 1, 69], ["D", -1, 69], ["D", 0, 153], ["D", 1, 117], ["D", 0, 40], ["P", 0, 140]],
  "reverse-corner": [["R", 0, 132], ["R", -1, 202], ["R", 0, 160], ["P", 0, 140]],
  diagonal: [["D", 0, 366], ["D", -1, 59], ["D", 0, 52], ["P", 0, 140]],
};

const trials = getLevels();

test("each numbered trial narrows the bay and adds traffic and dividers", () => {
  assert.equal(new Set(trials.map((trial) => trial.id)).size, trials.length);
  assert.equal(trials.length, Object.keys(routes).length);
  for (const [index, trial] of trials.entries()) {
    if (index === 0) continue;
    const previous = trials[index - 1];
    assert.ok(trial.bay.width < previous.bay.width, trial.name);
    for (const kind of ["car", "barrier"]) {
      assert.ok(trial.obstacles.filter((obstacle) => obstacle.kind === kind).length
        > previous.obstacles.filter((obstacle) => obstacle.kind === kind).length, trial.name);
    }
  }
});

for (const trial of trials) {
  test(`${trial.name} is completable with the standard controls`, () => {
    for (const id of vehicleIds) {
      const car = createDriveState(trial.start);
      for (const [gear, steering, frames] of routes[trial.id]) {
        for (let frame = 0; frame < frames; frame++) {
          advanceDrive(car, { gear, steering, throttle: gear !== "P", brake: gear === "P" }, trial, 1 / ticks, 0, id);
        }
        assert.equal(car.impact, null, id);
      }
      assert.equal(car.result, "parked", id);
    }
  });
}

test("road lettering uses uncovered asphalt across numbered and endless courses", () => {
  const exampleLevels = [...trials, ...[11, 13, 20, 40, 250, 10000].map((number) => createEndlessTrial(trials, number).level)];
  const positions = new Set<string>();
  for (const trial of exampleLevels) {
    const signs = findRoadLettering(trial);
    assert.ok(signs.length > 0, trial.id);
    for (const sign of signs) {
      positions.add(`${sign.x},${sign.z}`);
      assert.ok(sign.width >= 4.8, trial.id);
      for (const obstacle of trial.obstacles) {
        const { width, length } = obstacleSize(obstacle);
        const across = Math.abs(Math.cos(obstacle.yaw));
        const along = Math.abs(Math.sin(obstacle.yaw));
        assert.ok(Math.abs(sign.x - obstacle.x) >= (sign.width + width * across + length * along) / 2
          || Math.abs(sign.z - obstacle.z) >= (sign.length + width * along + length * across) / 2, trial.id);
      }
    }
  }
  assert.ok(positions.size > 4);
});

test("endless trials expand the lot and leave clearance on a playable route", () => {
  const numbers = [...Array.from({ length: 100 }, (_, index) => index + 11), 250, 1000, 10000, 1000000];
  let width = LOT_WIDTH;
  let length = LOT_LENGTH;
  let bayWidth = trials.at(-1)!.bay.width;
  const names = new Set<string>();
  for (const number of numbers) {
    const { level: generated, route } = createEndlessTrial(trials, number);
    assert.equal(generated.id, `endless-${number}`);
    assert.ok(generated.lot && generated.lot.width > width && generated.lot.length > length);
    assert.ok(generated.bay.width < bayWidth && generated.bay.width >= 2.03);
    width = generated.lot.width;
    length = generated.lot.length;
    bayWidth = generated.bay.width;
    names.add(generated.name);
    const completed = replayTrial(generated, route, 0.065);
    assert.equal(generated.stops?.length, number < 20 ? 1 : number < 40 ? 2 : 3);
    assert.equal(completed.stopIndex, generated.stops?.length);
    assert.equal(completed.result, "parked", `Trial ${number}`);
  }
  assert.equal(names.size, 4);
  assert.deepEqual(createEndlessTrial(trials, 1000), createEndlessTrial(trials, 1000));
});

test("the first parking stop advances the target without completing or resetting the trial", () => {
  const { level: generated, route } = createEndlessTrial(trials, 11);
  const first = replayTrial(generated, route.slice(0, 2));
  assert.equal(first.stopIndex, 1);
  assert.equal(first.result, null);
  assert.ok(generated.stops && Math.hypot(first.x - generated.stops[0].x, first.z - generated.stops[0].z) < 0.34);
  assert.equal(first.speed, 0);
});

test("higher endless trials require steering before parking at the first checkpoint", () => {
  for (const number of [40, 80, 250, 10000]) {
    const { level: trial, route } = createEndlessTrial(trials, number);
    const stop = route.findIndex(([gear]) => gear === "P");
    assert.ok(route.slice(0, stop).some(([, steering]) => steering !== 0), trial.id);
    const approach = route.slice(0, stop + 1);
    const completedStop = replayTrial(trial, approach, 0.065);
    assert.equal(completedStop.stopIndex, 1, trial.id);
    assert.equal(completedStop.impact, null, trial.id);
    assert.equal(replayTrial(trial, approach.map(([gear, , frames]) => [gear, 0, frames])).stopIndex, 0, trial.id);
  }
});

test("the extended asphalt is drivable past the original lot wall", () => {
  const { level: generated } = createEndlessTrial(trials, 11);
  const car = createDriveState({ x: LOT_WIDTH / 2 - 1, z: 0, yaw: -Math.PI / 2 });
  const trial = { ...generated, obstacles: [] };
  for (let i = 0; i < 100; i++) advanceDrive(car, input, trial, 1 / ticks);
  assert.ok(car.x > LOT_WIDTH / 2);
  assert.equal(car.impact, null);
});
