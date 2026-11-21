import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { Group } from "three";
import { vehicles } from "../lib/utils/garage.ts";
import { createVehicleWheels } from "../lib/utils/vehicle-wheels.ts";
import { vehicleIds } from "../types/vehicle.ts";

interface RigDocument {
  nodes: { name?: string; children?: number[]; mesh?: number; extras?: { open_rotation?: number[]; front_lid?: boolean } }[];
  meshes: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[];
  accessors: { count: number }[];
  scenes: { nodes: number[] }[];
}

function readRig(asset: string): RigDocument {
  const file = readFileSync(new URL(`../public/models/car/${asset}.glb`, import.meta.url));
  assert.equal(file.toString("ascii", 0, 4), "glTF");
  return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8")) as RigDocument;
}

function descendants(document: RigDocument, roots: number[]): RigDocument["nodes"] {
  return roots.flatMap((id) => [document.nodes[id], ...descendants(document, document.nodes[id].children ?? [])]);
}

test("every Garage car has independent front-door and luggage hinges carrying mesh geometry", () => {
  const files = new Set(Object.values(vehicles).map(({ asset }) => asset));
  const assets = new Map(Array.from(files, (asset) => [asset, readRig(asset)]));
  for (const id of vehicleIds) {
    const document = assets.get(vehicles[id].asset);
    assert.ok(document, id);
    const roots = document.scenes[0].nodes;
    const suffix = vehicles[id].asset.startsWith("traffic-pack") ? `_${id}` : "";
    const car = suffix ? roots.find((node) => document.nodes[node].name === id) : roots[0];
    assert.ok(car !== undefined, `${id} needs its own model`);
    assert.ok(existsSync(new URL(`../public/garage-thumbnails/${id}.webp`, import.meta.url)), `${id} needs a catalog image`);
    const parts = descendants(document, [car]);
    for (const wheel of ["FL", "FR", "RL", "RR"]) {
      assert.ok(parts.some(({ name }) => name === `wheel_${wheel}_mesh${suffix}`), `${id} needs a rolling ${wheel} tire`);
    }
    for (const name of ["door_FL", "door_FR", "boot"]) {
      const hinge = parts.find((part) => part.name === name);
      assert.ok(hinge?.children, `${id} needs ${name}`);
      const triangles: number = descendants(document, hinge.children).flatMap((part) =>
        part.mesh === undefined ? [] : document.meshes[part.mesh].primitives).reduce((count, primitive) =>
        count + document.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0);
      assert.ok(triangles > 4, `${id} ${name} must carry visible geometry`);
    }
  }
});

test("the catalog includes every car from the supplied 33-car pack", () => {
  const packIds = vehicleIds.filter((id) => vehicles[id].asset.startsWith("traffic-pack"));
  const assets = new Set(packIds.map((id) => vehicles[id].asset));
  const modelNames = [...assets].flatMap((asset) => {
    const { nodes, scenes } = readRig(asset);
    return scenes[0].nodes.map((index) => nodes[index].name);
  });
  assert.equal(modelNames.length, 33);
  assert.deepEqual(modelNames.sort(), packIds.sort());
});

test("model-specific motion distinguishes scissor doors, a front trunk and a rear-hinged door", () => {
  const pack = readRig("traffic-pack-2");
  const lambo = pack.scenes[0].nodes.find((index) => pack.nodes[index].name === "lamborghini-v1");
  assert.ok(lambo !== undefined);
  const panels = descendants(pack, [lambo]);
  assert.ok((panels.find(({ name }) => name === "door_FL")?.extras?.open_rotation?.[0] ?? 0) > 1);
  assert.equal(panels.find(({ name }) => name === "boot")?.extras?.front_lid, true);

  const luxury = readRig("traffic-pack-5");
  const rolls = luxury.scenes[0].nodes.find((index) => luxury.nodes[index].name === "rolls-royce");
  assert.ok(rolls !== undefined);
  const doors = descendants(luxury, [rolls]);
  const front = doors.find(({ name }) => name === "door_FL")?.extras?.open_rotation?.[1] ?? 0;
  const rear = doors.find(({ name }) => name === "door_RL")?.extras?.open_rotation?.[1] ?? 0;
  assert.ok(front * rear < 0);
});

test("the tires roll by distance, reverse, and steer at the front axle", () => {
  const car = new Group();
  const front = new Group();
  const rear = new Group();
  const frontTire = new Group();
  const rearTire = new Group();
  front.name = "wheel_FL_test";
  rear.name = "wheel_RL_test";
  frontTire.name = "wheel_FL_mesh_test";
  rearTire.name = "wheel_RL_mesh_test";
  front.position.y = rear.position.y = 0.5;
  front.add(frontTire);
  rear.add(rearTire);
  car.add(front, rear);

  const turnWheels = createVehicleWheels(car, "_test");
  turnWheels(1, 0.5);
  assert.equal(frontTire.rotation.x, 2);
  assert.equal(rearTire.rotation.x, 2);
  assert.ok(front.rotation.y < 0);
  assert.equal(rear.rotation.y, 0);
  turnWheels(0, 0);
  assert.equal(frontTire.rotation.x, 2);
  turnWheels(-1, 0);
  assert.equal(frontTire.rotation.x, 0);
  assert.equal(rearTire.rotation.x, 0);
});
