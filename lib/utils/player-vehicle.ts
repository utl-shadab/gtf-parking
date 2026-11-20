import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { VehicleId, VehicleSelection } from "@/types/vehicle";
import { CAR_LENGTH, MAX_PLAYER_WIDTH } from "./driving";
import { vehicles } from "./garage";
import { rosterFootprints } from "./roster-footprints";

const carModels = new Map<string, Promise<THREE.Group>>();

export function loadCarAsset(asset: string, renderer: THREE.WebGLRenderer) {
  const cached = carModels.get(asset);
  if (cached) return cached;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const textures = asset.startsWith("street-")
    ? new KTX2Loader().setTranscoderPath("/basis/").setWorkerLimit(2).detectSupport(renderer) : undefined;
  if (textures) loader.setKTX2Loader(textures);
  const request = loader.loadAsync(`/models/car/${asset}.glb`).then(({ scene }) => scene).catch((error: unknown) => {
    carModels.delete(asset);
    throw error;
  }).finally(() => textures?.dispose());
  carModels.set(asset, request);
  return request;
}

export async function loadPlayerVehicle(id: VehicleId, renderer: THREE.WebGLRenderer) {
  const { asset } = vehicles[id];
  const group = await loadCarAsset(asset, renderer);
  if (!asset.startsWith("traffic-pack")) return group;
  const car = group.getObjectByName(id);
  if (!car) throw new Error(`Vehicle missing from traffic pack: ${id}`);
  return car;
}

export function buildPlayerVehicle(source: THREE.Object3D, id: VehicleId, reflections?: THREE.Texture) {
  const model = source.clone(true);
  const info = vehicles[id];
  const dimensions = id === "gt" || id === "thar" ? undefined : rosterFootprints[id];
  const bounds = new THREE.Box3().setFromObject(model, true);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  const alignment = new THREE.Group();
  alignment.rotation.y = dimensions?.facing ?? Math.PI;
  alignment.add(model);
  const root = new THREE.Group();
  root.add(alignment);
  root.scale.setScalar(dimensions ? dimensions.length / size.z : Math.min(MAX_PLAYER_WIDTH / size.x, CAR_LENGTH / size.z));

  const roof = model.getObjectByName("RemovableRoof");
  const paints = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
  const customizePaint = (original: THREE.Material) => {
    if (!(original instanceof THREE.MeshStandardMaterial) || original.name !== info.paint) return original;
    const cached = paints.get(original);
    if (cached) return cached;
    const paint = original.clone();
    if (reflections) {
      paint.envMap = reflections;
      paint.envMapIntensity = 0.7;
    }
    paints.set(original, paint);
    return paint;
  };
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material) ? object.material.map(customizePaint) : customizePaint(object.material);
  });
  if (info.roof !== undefined && !roof) throw new Error(`Invalid roof on ${id}`);
  return {
    root,
    size: size.multiplyScalar(root.scale.x),
    customize({ color, roof: installed }: VehicleSelection) {
      paints.forEach((paint, original) => {
        if (info.asset.startsWith("traffic-pack") && color === info.color) paint.color.copy(original.color);
        else paint.color.set(color);
      });
      if (roof) roof.visible = installed;
    },
    dispose() {
      paints.forEach((paint) => paint.dispose());
    },
  };
}
