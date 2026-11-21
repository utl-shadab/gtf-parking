import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Box3, CompressedTexture, Matrix4, Mesh, Vector3, type Object3D } from "three";
import { GLTFLoader, type GLTFParser } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

type XYZ = [number, number, number];
type Plane = (x: number, y: number, z: number) => number;
type CompressionMode = "ATTRIBUTES" | "TRIANGLES";
type NumericArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;
interface NumericFormat {
  new (length: number): NumericArray;
  readonly BYTES_PER_ELEMENT: number;
}
interface BufferRange { buffer: number; byteLength: number; byteOffset?: number }
interface BufferView extends BufferRange {
  byteStride?: number;
  extensions?: { EXT_meshopt_compression?: BufferRange & {
    byteStride: number; count: number; mode: CompressionMode; filter: "NONE";
  } };
}
interface Accessor {
  bufferView: number; type: string; componentType: number; count: number;
  normalized?: boolean; min?: number[]; max?: number[];
}
interface Primitive { attributes: Record<string, number>; indices?: number; material?: number }
interface VehicleGlb {
  nodes: { mesh?: number; name?: string; children?: number[]; matrix?: number[];
    translation?: number[]; extras?: { open_rotation: XYZ; front_lid?: boolean } }[];
  meshes: { primitives: Primitive[] }[];
  accessors: Accessor[];
  bufferViews: BufferView[];
  buffers: { byteLength: number }[];
  materials: { doubleSided?: boolean }[];
  images?: { bufferView?: number }[];
}
interface VehicleBounds { size: Vector3; center: Vector3; floor: number }
interface Panel { name: string; at: Vector3; rotation: XYZ; planes: Plane[]; frontBoot?: boolean }
interface Vertex { car: XYZ; data: number[] }

// node --experimental-strip-types scripts/rig-city-cars.ts <source GLBs> <output directory> <meshoptimizer index.js>
const [source, destination, encoderModule] = process.argv.slice(2);
assert(source && destination && encoderModule && resolve(source) !== resolve(destination));
const { MeshoptEncoder } = await import(pathToFileURL(resolve(encoderModule)).href) as {
  MeshoptEncoder: {
    ready: Promise<void>;
    encodeGltfBuffer(bytes: Uint8Array, count: number, stride: number, mode: CompressionMode): Uint8Array;
  };
};
await MeshoptEncoder.ready;

// The bake reads geometry only. The original GLB texture bytes and materials are kept.
Object.assign(globalThis, {
  self: globalThis,
  createImageBitmap: async (): Promise<ImageBitmap> => ({ width: 1, height: 1, close() {} }),
});
const geometryOnlyKtx = new KTX2Loader();
const placeholderTexture = () => new CompressedTexture([], 1, 1);
geometryOnlyKtx.parse = (_buffer, loaded) => { loaded?.(placeholderTexture()); };
geometryOnlyKtx.load = (_url, loaded) => {
  const texture = placeholderTexture();
  loaded?.(texture);
  return texture;
};
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(geometryOnlyKtx);

const hatch = new Set(["hatch", "suv", "fortuner", "legender", "endeavour", "scorpio", "supra", "police-4"]);
const sideGate = new Set(["defender", "g-class", "bolero", "roxx", "thar-normal", "thar-modified", "thar"]);
const frontLid = new Set(["audi", "bugatti", "ferrari", "porsche", "lamborghini-v1", "lamborghini-2022", "koenigsegg"]);
const scissor = new Set(["lamborghini-v1", "lamborghini-2022", "koenigsegg"]);
const sideGateSeams: Record<string, number> = { defender: -0.37, "g-class": -0.39, bolero: -0.42, roxx: -0.36,
  "thar-normal": -0.36, "thar-modified": -0.42, thar: -0.42 };
const fourDoor = new Set(["suv", "hatch", "fortuner", "legender", "endeavour", "scorpio", "police-4", "police",
  "bolero", "roxx", "defender", "g-class", "rolls-royce", "hummer"]);

// Front seam, B-pillar and sill height in each source car's normalized bounds.
const doorSeams: Record<string, XYZ> = {
  gt: [0.16, -0.18, 0.24], hatch: [0.21, -0.025, 0.24], suv: [0.21, -0.035, 0.25],
  audi: [0.19, -0.17, 0.23], ferrari: [0.23, -0.16, 0.22], fortuner: [0.23, -0.025, 0.29],
  defender: [0.24, -0.012, 0.29], gtr: [0.19, -0.20, 0.23], porsche: [0.19, -0.15, 0.25],
  mustang: [0.17, -0.20, 0.24], roxx: [0.21, -0.018, 0.31], bolero: [0.22, -0.025, 0.29],
  bugatti: [0.23, -0.15, 0.24], endeavour: [0.19, -0.03, 0.29], legender: [0.22, -0.025, 0.29],
  "lamborghini-v1": [0.23, -0.18, 0.23], "lamborghini-2022": [0.23, -0.17, 0.23],
  "g-class": [0.21, -0.025, 0.30], police: [0.20, -0.045, 0.23], "police-4": [0.19, -0.024, 0.23],
  "rolls-royce": [0.14, -0.046, 0.25], scorpio: [0.19, -0.026, 0.27], tarzen: [0.20, -0.16, 0.23],
  "thar-modified": [0.18, -0.16, 0.32], "thar-normal": [0.19, -0.17, 0.32], thar: [0.21, -0.16, 0.32],
  koenigsegg: [0.24, -0.16, 0.29], supra: [0.18, -0.18, 0.24], hummer: [0.23, -0.027, 0.31],
};

function panelsFor(id: string, bounds: VehicleBounds) {
  const base = id === "monster-thar" ? "thar" : id.replace(/^monster-/, "");
  const truck = id.startsWith("monster-");
  const seams = doorSeams[base];
  assert(seams, `Missing body measurements for ${id}`);
  const [front, back, sill] = seams;
  const bodyY = (height: number) => truck ? 0.43 + height * 0.57 : height;
  const at = (x: number, y: number, z: number) => new Vector3(bounds.center.x + x * bounds.size.x,
    bounds.floor + y * bounds.size.y, bounds.center.z + z * bounds.size.z);
  const panels: Panel[] = [];
  const bodyWidth = truck ? 0.28 : 0.37;
  const sillY = bodyY(sill);
  const upper = bodyY(sideGate.has(base) ? 0.925 : 0.915);
  const windshield = sideGate.has(base) ? 0.10 : 0.23;
  const roofInset = truck ? 0.20 : 0.255;
  for (const side of [1, -1]) {
    const suffix = side > 0 ? "L" : "R";
    const basePlanes: Plane[] = [(x) => side * x - roofInset, (x, y) => side * x - roofInset + (y - bodyY(0.67)) * 0.14,
      (_x, y) => y - sillY, (_x, y) => upper - y];
    panels.push({
      name: "door_F" + suffix, at: at(side * bodyWidth, bodyY(0.49), front - 0.015),
      rotation: scissor.has(base) ? [1.12, -side * 0.20, 0] : [0, -side * 1.05, 0],
      planes: [...basePlanes, (_x, _y, z) => front - z, (_x, y, z) => front - z - (y - bodyY(0.56)) * windshield,
        (_x, _y, z) => z - back],
    });
    if (fourDoor.has(base)) {
      const rear = base === "hummer" ? -0.22 : -0.29;
      const reverseHinge = base === "rolls-royce";
      panels.push({
        name: "door_R" + suffix, at: at(side * bodyWidth, bodyY(0.48), reverseHinge ? rear + 0.02 : back - 0.02),
        rotation: [0, (reverseHinge ? side : -side) * 0.97, 0],
        planes: [...basePlanes, (_x, _y, z) => back - 0.008 - z, (_x, _y, z) => z - rear,
          (_x, y, z) => z - rear + (y - bodyY(0.48)) * 0.72],
      });
    }
  }
  const frontBoot = frontLid.has(base);
  const sideSwing = sideGate.has(base);
  const lift = hatch.has(base);
  const pickup = base === "hummer";
  const hingeZ = frontBoot ? 0.235 : sideSwing ? sideGateSeams[base] : pickup ? -0.455 : lift ? -0.295 : -0.29;
  const hingeY = bodyY(frontBoot ? 0.57 : pickup ? 0.41 : sideSwing ? 0.60 : lift ? 0.85 : 0.61);
  const lower = bodyY(frontBoot ? 0.43 : lift ? 0.40 : sideSwing || pickup ? 0.37 : 0.46);
  const bootWidth = truck ? 0.30 : sideSwing || lift || pickup ? 0.39 : 0.34;
  panels.push({
    name: "boot", at: at(sideSwing ? bootWidth : 0, hingeY, hingeZ),
    rotation: sideSwing ? [0, -1.36, 0] : [frontBoot || pickup ? -1.04 : 1.02, 0, 0],
    frontBoot,
    planes: [(x) => bootWidth - x, (x) => bootWidth + x, (_x, y) => y - lower,
      (_x, _y, z) => frontBoot ? z - hingeZ : hingeZ - z,
      (_x, y, z) => frontBoot ? z - hingeZ + (y - bodyY(0.50)) * 0.35
        : hingeZ - z + (y - bodyY(lift ? 0.84 : 0.61)) * (sideSwing || pickup ? 0.02 : 0.45)],
  });
  return panels;
}

function readGlb(buffer: Buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  return { json: JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8")) as VehicleGlb,
    binary: buffer.subarray(28 + jsonLength) };
}

function writeGlb(json: VehicleGlb, buffers: Buffer[], bytes: number) {
  const data = Buffer.from(JSON.stringify(json));
  const pad = (4 - data.length % 4) % 4;
  const header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + data.length + pad + bytes, 8);
  header.writeUInt32LE(data.length + pad, 12);
  header.write("JSON", 16);
  const bin = Buffer.alloc(8);
  bin.writeUInt32LE(bytes);
  bin.write("BIN", 4);
  return Buffer.concat([header, data, Buffer.alloc(pad, 32), bin, ...buffers]);
}

function compactGlb(json: VehicleGlb, binary: Buffer) {
  function keep<T>(items: T[], ids: number[], remap: (index: (id: number) => number) => void) {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const indices = new Map(sorted.map((id, newIndex) => [id, newIndex]));
    remap((id) => {
      const index = indices.get(id);
      assert(index !== undefined);
      return index;
    });
    return sorted.map((id) => items[id]);
  }
  const meshes = json.nodes.filter((node): node is typeof node & { mesh: number } => node.mesh !== undefined);
  json.meshes = keep(json.meshes, meshes.map(({ mesh }) => mesh),
    (index) => meshes.forEach((node) => { node.mesh = index(node.mesh); }));
  const primitives = [...new Set(json.meshes.flatMap((mesh) => mesh.primitives))];
  const accessorIds = primitives.flatMap((primitive) => [primitive.indices, ...Object.values(primitive.attributes)]
    .filter((id): id is number => id !== undefined));
  json.accessors = keep(json.accessors, accessorIds, (index) => {
    for (const primitive of primitives) {
      if (primitive.indices !== undefined) primitive.indices = index(primitive.indices);
      for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = index(primitive.attributes[key]);
    }
  });
  const views = [...json.accessors, ...(json.images ?? [])]
    .filter((item): item is { bufferView: number } => item.bufferView !== undefined);
  json.bufferViews = keep(json.bufferViews, views.map(({ bufferView }) => bufferView),
    (index) => views.forEach((item) => { item.bufferView = index(item.bufferView); }));
  const chunks = [];
  let size = 0;
  let fallback = 0;
  for (const view of json.bufferViews) {
    const compressed = view.extensions?.EXT_meshopt_compression;
    const stored = compressed ?? view;
    assert.equal(stored.buffer, 0);
    const start = stored.byteOffset ?? 0;
    const end = start + stored.byteLength;
    stored.byteOffset = size;
    const chunk = Buffer.alloc(Math.ceil(stored.byteLength / 4) * 4);
    chunk.set(binary.subarray(start, end));
    chunks.push(chunk);
    size += chunk.length;
    if (view.buffer === 1) {
      view.byteOffset = fallback;
      fallback += Math.ceil(view.byteLength / 4) * 4;
    }
  }
  json.buffers[0].byteLength = size;
  json.buffers[1].byteLength = fallback;
  return writeGlb(json, chunks, size);
}

const componentFormats: Record<number, readonly [NumericFormat, number]> = {
  5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767],
  5123: [Uint16Array, 65535], 5126: [Float32Array, 1],
};

function writer(json: VehicleGlb, binary: Buffer) {
  const buffers = [binary];
  let bytes = binary.length;
  let fallback = json.buffers[1].byteLength;
  const doubleSidedMaterials = new Map<number, number>();
  function accessor(array: NumericArray, count: number, stride: number, type: string, componentType: number,
    mode: CompressionMode, options: Pick<Accessor, "normalized" | "min" | "max"> = {}) {
    const encoded = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(array.buffer), count, stride, mode);
    fallback = Math.ceil(fallback / 4) * 4;
    const view: BufferView = {
      buffer: 1, byteOffset: fallback, byteLength: array.byteLength,
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: bytes, byteLength: encoded.length,
        byteStride: stride, count, mode, filter: "NONE" } },
    };
    if (mode === "ATTRIBUTES") view.byteStride = stride;
    const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4);
    padded.set(encoded);
    buffers.push(padded);
    bytes += padded.length;
    fallback += array.byteLength;
    return json.accessors.push({ bufferView: json.bufferViews.push(view) - 1, componentType, count, type, ...options }) - 1;
  }
  function attribute(vertices: number[][], original: number, start: number, dimensions: number, bounds = false) {
    const { componentType, normalized, type } = json.accessors[original];
    const [Format, scale] = componentFormats[componentType];
    const elements = Math.ceil(dimensions * Format.BYTES_PER_ELEMENT / 4) * 4 / Format.BYTES_PER_ELEMENT;
    const data = new Format(vertices.length * elements);
    const min = Array(dimensions).fill(Infinity);
    const max = Array(dimensions).fill(-Infinity);
    for (const [i, vertex] of vertices.entries()) {
      for (let axis = 0; axis < dimensions; axis++) {
        const value = vertex[start + axis];
        const offset = i * elements + axis;
        data[offset] = normalized ? Math.round(value * scale) : value;
        min[axis] = Math.min(min[axis], data[offset]);
        max[axis] = Math.max(max[axis], data[offset]);
      }
    }
    return accessor(data, vertices.length, elements * Format.BYTES_PER_ELEMENT, type, componentType, "ATTRIBUTES", {
      ...(normalized ? { normalized } : {}), ...(bounds ? { min, max } : {}),
    });
  }
  return {
    primitive(bucket: Vertex[], previous: Primitive, moving: boolean): Primitive {
      const unique = new Map<string, number>();
      const vertices: number[][] = [];
      const flat = [];
      for (const point of bucket) {
        const key = point.data.map(Math.fround).join(",");
        let vertex = unique.get(key);
        if (vertex === undefined) {
          vertex = vertices.length;
          unique.set(key, vertex);
          vertices.push(point.data);
        }
        flat.push(vertex);
      }
      const count = vertices.length;
      const indices = count < 65536 ? new Uint16Array(flat) : new Uint32Array(flat);
      const primitive: Primitive = {
        attributes: {
          POSITION: attribute(vertices, previous.attributes.POSITION, 0, 3, true),
          NORMAL: attribute(vertices, previous.attributes.NORMAL, 3, 3),
        },
        indices: accessor(indices, flat.length, indices.BYTES_PER_ELEMENT, "SCALAR", count < 65536 ? 5123 : 5125, "TRIANGLES"),
        material: previous.material,
      };
      if (previous.attributes.TEXCOORD_0 !== undefined) {
        primitive.attributes.TEXCOORD_0 = attribute(vertices, previous.attributes.TEXCOORD_0, 6, 2);
      }
      if (moving && previous.material !== undefined && !json.materials[previous.material].doubleSided) {
        if (!doubleSidedMaterials.has(previous.material)) {
          doubleSidedMaterials.set(previous.material, json.materials.push({ ...json.materials[previous.material], doubleSided: true }) - 1);
        }
        primitive.material = doubleSidedMaterials.get(previous.material);
      }
      return primitive;
    },
    finish() {
      return compactGlb(json, Buffer.concat(buffers, bytes));
    },
  };
}

function splitPolygon(polygon: Vertex[], plane: Plane): [Vertex[], Vertex[]] {
  const inside: Vertex[] = [];
  const outside: Vertex[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const da = plane(...a.car);
    const db = plane(...b.car);
    (da >= 0 ? inside : outside).push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      const interpolate = (from: number[], to: number[], axis: number) => from[axis] + (to[axis] - from[axis]) * t;
      const point: Vertex = {
        car: [interpolate(a.car, b.car, 0), interpolate(a.car, b.car, 1), interpolate(a.car, b.car, 2)],
        data: a.data.map((_, axis) => interpolate(a.data, b.data, axis)),
      };
      inside.push(point);
      outside.push(point);
    }
  }
  return [inside, outside];
}

function cut(polygon: Vertex[], planes: Plane[]): [Vertex[], Vertex[][]] {
  // Avoid subdividing stationary triangles that miss the panel completely.
  if (planes.some((plane) => polygon.every(({ car }) => plane(...car) < 0))) return [[], [polygon]];
  const outside = [];
  let inside = polygon;
  for (const plane of planes) {
    const result = splitPolygon(inside, plane);
    if (result[0].length < 3) return [[], [polygon]];
    inside = result[0];
    if (result[1].length > 2) outside.push(result[1]);
  }
  return [inside, outside];
}

function triangulate(polygon: Vertex[], output: Vertex[]) {
  const [first, ...rest] = polygon;
  for (let i = 0; i + 1 < rest.length; i++) output.push(first, rest[i], rest[i + 1]);
}

function partition(mesh: Mesh, bounds: VehicleBounds, panels: Panel[], modelInverse: Matrix4) {
  const { position, normal, uv } = mesh.geometry.attributes;
  const index = mesh.geometry.index;
  const transform = modelInverse.clone().multiply(mesh.matrixWorld);
  const point = new Vector3();
  const vertices = Array.from({ length: position.count }, (_, i): Vertex => {
    const data = [position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i)];
    if (uv) data.push(uv.getX(i), uv.getY(i));
    point.set(data[0], data[1], data[2]).applyMatrix4(transform);
    return { data, car: [(point.x - bounds.center.x) / bounds.size.x, (point.y - bounds.floor) / bounds.size.y,
      (point.z - bounds.center.z) / bounds.size.z] };
  });
  const buckets = Array.from({ length: panels.length }, (): Vertex[] => []);
  const body: Vertex[] = [];
  let moved = 0;
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    let rest = [[vertices[index?.getX(i) ?? i], vertices[index?.getX(i + 1) ?? i + 1], vertices[index?.getX(i + 2) ?? i + 2]]];
    for (const [panelIndex, panel] of panels.entries()) {
      const remaining = [];
      for (const polygon of rest) {
        const [inside, outside] = cut(polygon, panel.planes);
        if (inside.length) {
          triangulate(inside, buckets[panelIndex]);
          moved++;
        }
        remaining.push(...outside);
      }
      rest = remaining;
    }
    for (const polygon of rest) triangulate(polygon, body);
  }
  return moved ? { body, buckets, transform } : null;
}

const aliases: Record<string, string> = { "garage-gt.glb": "gt", "street-hatch.glb": "hatch", "street-suv.glb": "suv" };
function bakeCar(root: Object3D, id: string, json: VehicleGlb, output: ReturnType<typeof writer>,
  associations: GLTFParser["associations"]) {
  assert(!root.getObjectByName("door_FL"), id + " already has authored hinges");
  const modelInverse = root.matrixWorld.clone().invert();
  const box = new Box3().setFromObject(root, true).applyMatrix4(modelInverse);
  const bounds = { size: box.getSize(new Vector3()), center: box.getCenter(new Vector3()), floor: box.min.y };
  const panels = panelsFor(id, bounds);
  const rootIndex = associations.get(root)?.nodes;
  assert(rootIndex !== undefined);
  const rootNode = json.nodes[rootIndex];
  const affected = new Map<number, Map<number, Primitive | null>>();
  const moving = panels.map((): { local: Matrix4; primitive: Primitive; triangles: number }[] => []);
  root.traverse((mesh) => {
    if (!(mesh instanceof Mesh)) return;
    for (let part: Object3D | null = mesh; part && part !== root; part = part.parent) {
      if (/^(wheel[_. -]|tyre|tire|steering|interior$|seat|removableroof|body_\d*_?monster_truck)/i.test(part.name)) return;
    }
    const association = associations.get(mesh);
    assert(association?.meshes !== undefined && association.primitives !== undefined);
    const nodeIndex = association.nodes ?? (mesh.parent && associations.get(mesh.parent)?.nodes);
    assert(typeof nodeIndex === "number");
    const baked = partition(mesh, bounds, panels, modelInverse);
    if (!baked) return;
    const { body, buckets, transform } = baked;
    const original = json.meshes[association.meshes].primitives[association.primitives];
    const updates = affected.get(nodeIndex) ?? new Map<number, Primitive | null>();
    updates.set(association.primitives, body.length ? output.primitive(body, original, false) : null);
    affected.set(nodeIndex, updates);
    for (const [i, bucket] of buckets.entries()) {
      if (!bucket.length) continue;
      const pivot = panels[i].at;
      const local = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z).multiply(transform);
      const primitive = output.primitive(bucket, original, true);
      moving[i].push({ local, primitive, triangles: bucket.length / 3 });
    }
  });
  for (const [nodeIndex, changes] of affected) {
    const node = json.nodes[nodeIndex];
    assert(node.mesh !== undefined);
    const mesh = json.meshes[node.mesh];
    const primitives = mesh.primitives.flatMap((primitive, i) => changes.has(i) ? changes.get(i) ?? [] : primitive);
    if (primitives.length) node.mesh = json.meshes.push({ ...mesh, primitives }) - 1;
    else delete node.mesh;
  }
  for (const [i, panel] of panels.entries()) {
    const parts = moving[i];
    assert(parts.reduce((sum, part) => sum + part.triangles, 0) >= 4, id + " " + panel.name + " has too little geometry");
    const children = parts.map(({ local, primitive }) => json.nodes.push({
      matrix: Array.from(local.toArray()), mesh: json.meshes.push({ primitives: [primitive] }) - 1,
    }) - 1);
    rootNode.children ??= [];
    rootNode.children.push(json.nodes.push({ name: panel.name, translation: panel.at.toArray(), children,
      extras: { open_rotation: panel.rotation, ...(panel.frontBoot ? { front_lid: true } : {}) } }) - 1);
  }
  console.log(id + " " + panels.map(({ name }, i) => name + "=" + moving[i].reduce((n, p) => n + p.triangles, 0)).join(" "));
}

await mkdir(destination, { recursive: true });
for (const name of (await readdir(source)).filter((file) => file.endsWith(".glb"))) {
  if (name === "garage-thar.glb" || name === "street-sedan.glb") continue;
  const buffer = await readFile(join(source, name));
  const { json, binary } = readGlb(buffer);
  const { scene, parser } = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
  scene.updateMatrixWorld(true);
  const output = writer(json, binary);
  for (const root of scene.children) bakeCar(root, aliases[name] ?? root.name, json, output, parser.associations);
  await writeFile(join(destination, name), output.finish());
}
