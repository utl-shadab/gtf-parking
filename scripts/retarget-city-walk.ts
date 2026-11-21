import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

interface Node {
  name: string;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface Channel { sampler: number; target: { node: number; path: "rotation" | "translation" } }
interface Animation { name: string; channels: Channel[]; samplers: { input: number; output: number }[] }
interface Document {
  nodes: Node[];
  scenes: { nodes: number[] }[];
  accessors: { bufferView: number; componentType: number; count: number; type: string;
    byteOffset?: number; min?: number[]; max?: number[] }[];
  bufferViews: { buffer: number; byteLength: number; byteOffset?: number }[];
  buffers: { byteLength: number }[];
  skins: { joints: number[] }[];
  animations?: Animation[];
}

// node --experimental-strip-types scripts/retarget-city-walk.ts <original jinu.glb> [optimized jinu.glb]
const [originalFile, outputFile = "public/models/people/jinu.glb"] = process.argv.slice(2);
assert(originalFile && originalFile !== outputFile, "Supply the original and optimized Jinu GLBs");

function readGlb(path: string) {
  const file = readFileSync(path);
  assert.equal(file.toString("ascii", 0, 4), "glTF");
  const jsonSize = file.readUInt32LE(12);
  const json = JSON.parse(file.toString("utf8", 20, 20 + jsonSize)) as Document;
  return { json, bin: file.subarray(28 + jsonSize) };
}

function buildRig({ nodes, scenes }: Document) {
  const rig = nodes.map((node) => {
    const bone = new Object3D();
    if (node.matrix) new Matrix4().fromArray(node.matrix).decompose(bone.position, bone.quaternion, bone.scale);
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    if (node.scale) bone.scale.fromArray(node.scale);
    return bone;
  });
  const world = new Object3D();
  nodes.forEach(({ children }, index) => children?.forEach((child) => rig[index].add(rig[child])));
  scenes[0].nodes.forEach((index) => world.add(rig[index]));
  world.updateMatrixWorld(true);
  return rig;
}

const stock = readGlb("public/models/people/casual-man.glb");
const original = readGlb(originalFile);
const { json, bin } = readGlb(outputFile);
const oldAnimations = json.animations;
const animationAccessor = oldAnimations?.[0]?.samplers[0]?.input ?? json.accessors.length;
const animationView = json.accessors[animationAccessor]?.bufferView ?? json.bufferViews.length;
const animationOffset = json.bufferViews[animationView]?.byteOffset ?? json.buffers[0].byteLength;
json.accessors.length = animationAccessor;
json.bufferViews.length = animationView;
for (const { joints } of original.json.skins) {
  for (const index of joints) {
    const { name, rotation, translation, scale, matrix } = original.json.nodes[index];
    assert.equal(json.nodes[index].name, name);
    Object.assign(json.nodes[index], { rotation, translation, scale, matrix });
  }
}

const source = buildRig(stock.json);
const target = buildRig(original.json);
const sourceIndex = (name: string) => stock.json.nodes.findIndex((node) => node.name === name);
const targetIndex = (prefix: string) => original.json.nodes.findIndex((node) => node.name.startsWith(prefix));
const mappings = [
  ["Hips", "pelvis_"], ["Spine", "spine_02_"], ["Chest", "spine_04_"],
  ["Neck", "neck_01_"], ["Head", "head_"],
  ...(["L", "R"] as const).flatMap((side) => {
    const s = side.toLowerCase();
    return [
      [`UpperArm_${side}`, `upperarm_${s}_`, `LowerArm_${side}`, `lowerarm_${s}_`],
      [`LowerArm_${side}`, `lowerarm_${s}_`, `Hand_${side}`, `hand_${s}_`],
      [`UpperLeg_${side}`, `thigh_${s}_`, `LowerLeg_${side}`, `calf_${s}_`],
      [`LowerLeg_${side}`, `calf_${s}_`, `Foot_${side}`, `foot_${s}_`],
      [`Foot_${side}`, `foot_${s}_`],
    ];
  }),
];
const joints = mappings.map(([stockName, jinuName, stockChild, jinuChild]) => {
  const sample = source[sourceIndex(stockName)];
  const index = targetIndex(jinuName);
  const bone = target[index];
  assert(sample && bone && json.nodes[index].name === original.json.nodes[index].name);
  const sourceWorld = sample.getWorldQuaternion(new Quaternion());
  const targetWorld = bone.getWorldQuaternion(new Quaternion());
  if (stockChild && jinuChild) {
    const direction = (parent: Object3D, child: Object3D) =>
      child.getWorldPosition(new Vector3()).sub(parent.getWorldPosition(new Vector3())).normalize();
    targetWorld.premultiply(new Quaternion().setFromUnitVectors(
      direction(bone, target[targetIndex(jinuChild)]), direction(sample, source[sourceIndex(stockChild)]),
    ));
  }
  return { sample, index, bone, bindCorrection: sourceWorld.invert().multiply(targetWorld), values: [] as number[] };
});

const hips = joints[0].bone;
const standing = hips.position.clone();
const stockStanding = joints[0].sample.position.clone();
const ratio = hips.getWorldPosition(new Vector3()).y / stockStanding.y;
const toHipsParent = hips.parent!.getWorldQuaternion(new Quaternion()).invert();
const parentScale = hips.parent!.getWorldScale(new Vector3());
const hipsClip: number[] = [];
const buffers: Buffer[] = [bin.subarray(0, animationOffset)];
let bytes = animationOffset;
function append(values: number[], width: number, type: "SCALAR" | "VEC3" | "VEC4") {
  const part = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => part.writeFloatLE(value, index * 4));
  const bufferView = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: bytes, byteLength: part.length });
  buffers.push(part);
  bytes += part.length;
  const accessor = json.accessors.length;
  json.accessors.push({ bufferView, componentType: 5126, count: values.length / width, type,
    ...(width === 1 ? { min: [values[0]], max: [values.at(-1)!] } : {}) });
  return accessor;
}

function floats(index: number) {
  const accessor = stock.json.accessors[index];
  const width = accessor.type === "VEC4" ? 4 : accessor.type === "VEC3" ? 3 : 1;
  const offset = (stock.json.bufferViews[accessor.bufferView].byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  assert.equal(accessor.componentType, 5126);
  return Array.from({ length: accessor.count * width }, (_, i) => stock.bin.readFloatLE(offset + 4 * i));
}

json.animations = stock.json.animations?.map((clip) => {
  const frames = floats(clip.samplers[0].input);
  const channels = clip.channels.map(({ sampler, target: property }) => ({
    ...property, values: floats(clip.samplers[sampler].output), width: property.path === "rotation" ? 4 : 3,
  }));
  for (const joint of joints) joint.values.length = 0;
  hipsClip.length = 0;
  frames.forEach((_, frame) => {
    for (const { node, path, width, values } of channels) {
      const property = path === "rotation" ? source[node].quaternion : source[node].position;
      property.fromArray(values, frame * width);
    }
    const hipTravel = joints[0].sample.position.clone().sub(stockStanding).multiplyScalar(ratio);
    hips.position.copy(standing).add(hipTravel.applyQuaternion(toHipsParent).divide(parentScale));
    for (const { sample, bone, bindCorrection, index, values } of joints) {
      const global = sample.getWorldQuaternion(new Quaternion()).multiply(bindCorrection);
      const parent = bone.parent!.getWorldQuaternion(new Quaternion()).invert();
      bone.quaternion.copy(parent.multiply(global).normalize());
      values.push(...bone.quaternion.toArray());
      if (clip.name === "Idle" && frame === 0) json.nodes[index].rotation = bone.quaternion.toArray();
    }
    hipsClip.push(...hips.position.toArray());
    if (clip.name === "Idle" && frame === 0) json.nodes[joints[0].index].translation = hips.position.toArray();
  });
  const input = append(frames, 1, "SCALAR");
  const samplers = joints.map(({ values }) => ({ input, output: append(values, 4, "VEC4") }));
  const outputChannels: Channel[] = joints.map(({ index }, sampler) => ({ sampler, target: { node: index, path: "rotation" } }));
  outputChannels.push({ sampler: samplers.length, target: { node: joints[0].index, path: "translation" } });
  samplers.push({ input, output: append(hipsClip, 3, "VEC3") });
  return { name: clip.name, channels: outputChannels, samplers };
});
assert.equal(json.animations?.length, 3);
json.buffers[0].byteLength = bytes;
const metadata = Buffer.from(JSON.stringify(json));
const padded = Buffer.concat([metadata, Buffer.alloc((-metadata.length) & 3, 0x20)]);
const header = Buffer.alloc(20);
header.write("glTF");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + padded.length + bytes, 8);
header.writeUInt32LE(padded.length, 12);
header.write("JSON", 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bytes, 0);
binHeader.write("BIN", 4);
writeFileSync(outputFile, Buffer.concat([header, padded, binHeader, ...buffers]));
