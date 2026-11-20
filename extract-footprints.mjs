import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
for (const model of ['player-hatch', 'street-hatch', 'street-sedan', 'street-suv']) {
  const source = await readFile(`public/models/car/${model}.glb`);
  const jsonLength = source.readUInt32LE(12);
  const gltf = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
  gltf.materials = gltf.materials.map(() => ({}));
  gltf.extensionsUsed = gltf.extensionsUsed.filter((extension) => !extension.startsWith('KHR_materials_') && extension !== 'KHR_texture_basisu');
  delete gltf.textures;
  delete gltf.images;
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const fresh = Buffer.concat([source.subarray(0, 20), padded, source.subarray(20 + jsonLength)]);
  fresh.writeUInt32LE(fresh.length, 8);
  fresh.writeUInt32LE(padded.length, 12);
  const { scene } = await loader.parseAsync(fresh.buffer.slice(fresh.byteOffset, fresh.byteOffset + fresh.byteLength), '');
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const coords = [];
  const point = new Vector3();
  scene.traverse((node) => {
    if (!node.isMesh || /mirror/.test(node.name)) return;
    const position = node.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      coords.push([-(point.x - center.x) / size.x, -(point.z - center.z) / size.z]);
    }
  });
  coords.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const halfHull = (list) => {
    const outer = [];
    for (const p of list) {
      while (outer.length >= 2 && cross(outer.at(-2), outer.at(-1), p) <= 1e-8) outer.pop();
      outer.push(p);
    }
    return outer.slice(0, -1);
  };
  const hull = [...halfHull(coords), ...halfHull(coords.reverse())];
  while (hull.length > 8) {
    let best = Infinity;
    let bestIndex = -1;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[(i + hull.length - 1) % hull.length], b = hull[i], c = hull[(i+1)%hull.length];
      const error = Math.abs(cross(a, b, c)) / Math.hypot(c[0]-a[0],c[1]-a[1]);
      if (error < best) { best = error; bestIndex = i; }
    }
    if (best > .009) break;
    hull.splice(bestIndex, 1);
  }
  console.log(model, JSON.stringify(hull.map((p) => p.map((v) => Number(v.toFixed(3))))));
}
