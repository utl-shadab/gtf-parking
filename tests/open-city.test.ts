import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AnimationMixer, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { cityProgress } from "../lib/utils/city-progress.ts";
import { cityFootMotion, crossedRed, isDeepWater, trafficSignal } from "../lib/utils/city-rules.ts";
import { busRoute, nextTransitStop } from "../lib/utils/city-transit.ts";
import { advanceDrive, createDriveState } from "../lib/utils/driving.ts";
import { sampleCarTransfer, type CarTransfer } from "../lib/utils/city-car-transfer.ts";

function glbDocument(path: string) {
  const file = readFileSync(new URL(`../public/models/${path}.glb`, import.meta.url));
  assert.equal(file.toString("ascii", 0, 4), "glTF");
  return JSON.parse(file.toString("utf8", 20, 20 + file.readUInt32LE(12))) as {
    animations?: { name: string }[];
    materials?: { name: string }[];
    nodes: { name?: string; extras?: { kind?: string }; skin?: number }[];
  };
}

test("City exports usable bench anchors, homes, businesses, and the Bay Line train", () => {
  const { materials, nodes } = glbDocument("city/open-city");
  const kinds = nodes.map((node) => node.extras?.kind);
  assert.equal(kinds.filter((kind) => kind === "bench").length, 8);
  assert.equal(nodes.filter((node) => node.name?.startsWith("House · Maple Row")).length, 6);
  assert.ok(kinds.includes("shop"));
  assert.ok(kinds.includes("restaurant"));
  assert.ok(kinds.includes("train_vehicle"));
  assert.ok(materials?.some(({ name }) => name === "Coastal shallows"));
});

test("The City avatar and pedestrians ship with usable rigs", () => {
  const avatar = glbDocument("people/jinu");
  assert.ok(avatar.nodes.some((node) => node.skin !== undefined));
  assert.ok(avatar.nodes.some((node) => node.name?.startsWith("thigh_l_")));
  assert.deepEqual(avatar.animations?.map((clip) => clip.name).sort(), ["Idle", "Run", "Walk"]);
  for (const name of ["casual-man", "casual-woman", "business-man", "business-woman"]) {
    const model = glbDocument(`people/${name}`);
    assert.ok(model.nodes.some((node) => node.skin !== undefined), name);
    assert.deepEqual(model.animations?.map((clip) => clip.name).sort(), ["Idle", "Run", "Walk"], name);
  }
});

test("Jinu stands with both shoes forward and takes alternating steps", async () => {
  Object.assign(globalThis, {
    self: globalThis,
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
  });
  const file = readFileSync(new URL("../public/models/people/jinu.glb", import.meta.url));
  const { scene, animations } = await new GLTFLoader().parseAsync(Uint8Array.from(file).buffer, "");
  function position(name: string) {
    const joint = scene.getObjectByName(name);
    assert.ok(joint, name);
    return joint.getWorldPosition(new Vector3());
  }
  for (const [ankle, toe] of [["foot_l_226", "ball_l_225"], ["foot_r_240", "ball_r_239"]]) {
    const shoe = position(toe).sub(position(ankle));
    assert.ok(shoe.z > 0.2 && Math.abs(shoe.x) < 0.07, `${ankle} points forward`);
  }
  const walk = animations.find(({ name }) => name === "Walk");
  assert.ok(walk);
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(walk).play();
  mixer.setTime(walk.duration / 4);
  assert.ok(position("foot_l_226").z > position("foot_r_240").z + 0.8);
  assert.ok(position("hand_l_134").z < position("hand_r_176").z);
  mixer.setTime(walk.duration * 0.75);
  assert.ok(position("foot_r_240").z > position("foot_l_226").z + 0.8);
  assert.ok(position("hand_r_176").z < position("hand_l_134").z);
  mixer.uncacheRoot(scene);
});

test("walking faces the actual route and speed drops to zero at obstacles", () => {
  const dt = 1 / 60;
  const diagonal = cityFootMotion(dt, -dt, Math.PI - 0.1, dt);
  assert.ok(Math.abs(diagonal.speed - Math.SQRT2) < 1e-6);
  let yaw = diagonal.yaw;
  for (let frame = 0; frame < 16; frame++) yaw = cityFootMotion(dt, 0, yaw, dt).yaw;
  assert.ok(-Math.sin(yaw) > 0.99);
  assert.ok(Math.abs(Math.cos(yaw)) < 0.03);
  assert.deepEqual(cityFootMotion(0, 0, yaw, dt), { speed: 0, yaw });
});

test("District progression starts when Trial 10 is cleared", () => {
  assert.deepEqual(cityProgress(10, 9, false, 0), { unlocked: 0, target: 10, completed: 9 });
  assert.equal(cityProgress(10, 9, false, 20).unlocked, 0);
  assert.deepEqual(cityProgress(10, 10, true, 0), { unlocked: 1, target: 10, completed: 0 });
});

const boarding: CarTransfer = {
  entering: true,
  start: { x: 2, y: 0, z: 1, yaw: Math.PI / 2 },
  sill: { x: 1, y: 0.07, z: 0, yaw: Math.PI / 2 },
  seat: { x: 0.33, y: 0.28, z: 0, yaw: 0 },
};

test("entering opens the door before stepping inside and closes it after sitting", () => {
  const waiting = sampleCarTransfer(boarding, 0);
  const stepping = sampleCarTransfer(boarding, 0.6);
  const seated = sampleCarTransfer(boarding, 1);
  assert.deepEqual(waiting.pose, boarding.start);
  assert.equal(waiting.door, 0);
  assert.equal(stepping.door, 1);
  assert.ok(stepping.seated > 0 && stepping.seated < 1);
  assert.ok(stepping.pose.x > boarding.seat.x && stepping.pose.x < boarding.sill.x);
  assert.deepEqual(seated.pose, boarding.seat);
  assert.equal(seated.door, 0);
  assert.equal(seated.seated, 1);
});

test("exiting opens from the seat and closes once the player has stepped clear", () => {
  const leaving = { ...boarding, entering: false };
  assert.deepEqual(sampleCarTransfer(leaving, 0).pose, boarding.seat);
  assert.equal(sampleCarTransfer(leaving, 0.29).door, 1);
  const clear = sampleCarTransfer(leaving, 1);
  assert.equal(clear.pose.x, boarding.start.x);
  assert.equal(clear.pose.z, boarding.start.z);
  assert.equal(clear.door, 0);
  assert.equal(clear.seated, 0);
});

test("every tenth endless clear unlocks the next available district", () => {
  for (const [endlessCleared, unlocked, completed] of [
    [7, 1, 7], [9, 1, 9], [10, 2, 0], [19, 2, 9], [20, 3, 0], [29, 3, 9], [30, 4, 0],
  ]) {
    assert.deepEqual(cityProgress(10, 10, true, endlessCleared), { unlocked, target: 10, completed });
  }
  assert.equal(cityProgress(10, 10, true, 50).unlocked, 4);
});

test("perpendicular signals alternate through amber and all-red before repeating", () => {
  for (const [time, northSouth, eastWest] of [
    [0, "green", "red"], [10.99, "green", "red"], [11, "amber", "red"],
    [14, "red", "red"], [15, "red", "green"], [26, "red", "amber"],
    [29, "red", "red"], [30, "green", "red"],
  ] as const) {
    assert.equal(trafficSignal(time, "z"), northSouth, `north–south at ${time}s`);
    assert.equal(trafficSignal(time, "x"), eastWest, `east–west at ${time}s`);
  }
  assert.equal(trafficSignal(7, "z", 4), "amber");
});

test("only entering a junction across the red stop line counts as a violation", () => {
  assert.equal(crossedRed(-42, -31, -40, -31, 1), true);
  assert.equal(crossedRed(-40, -31, -38, -31, 1), false);
  assert.equal(crossedRed(-40, -31, -42, -31, 1), false);
  assert.equal(crossedRed(-42, -31, -40, -31, 15), false);
  assert.equal(crossedRed(-42, -31, -40, -31, 26), false);
  assert.equal(crossedRed(-42, -39, -40, -39, 1), false);
});

test("the bus loops through all three named stops", () => {
  const [first, second, last] = busRoute.stops;
  assert.deepEqual(busRoute.stops.map(({ name }) => name), ["Juniper Park", "West Market", "Drift Beach"]);
  assert.equal(nextTransitStop(busRoute, first.at), second);
  assert.equal(nextTransitStop(busRoute, second.at), last);
  assert.equal(nextTransitStop(busRoute, last.at), first);
  const pose = { x: 0, z: 0, yaw: 0 };
  busRoute.sample(busRoute.length + first.at, pose);
  assert.equal(pose.x, 18);
  assert.equal(pose.z, 35);
});

test("the pier and beachfront remain walkable while the sea triggers swim mode", () => {
  assert.equal(isDeepWater(4, 114), false);
  assert.equal(isDeepWater(4, 150), true);
  assert.equal(isDeepWater(69, 157), false);
  assert.equal(isDeepWater(-82, 133), true);
});

test("hitting a city obstacle stops the car and allows it to reverse away", () => {
  const car = createDriveState({ x: 0, z: 0, yaw: 0 });
  const street = { speedLimit: 14.4, blocked: (_x: number, z: number) => z < -6 };
  const throttle = { steering: 0, throttle: true, brake: false };
  for (let step = 0; step < 600; step++) advanceDrive(car, { ...throttle, gear: "D" }, street, 1 / 120);
  assert.ok(car.z < -2 && car.z > -6);
  assert.equal(car.speed, 0);
  assert.equal(car.result, null);

  const stoppedAt = car.z;
  for (let step = 0; step < 120; step++) advanceDrive(car, { ...throttle, gear: "R" }, street, 1 / 120);
  assert.ok(car.z > stoppedAt + 0.5);
  assert.equal(car.result, null);
});
