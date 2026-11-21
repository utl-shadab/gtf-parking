import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { Group } from "three";

let tree: Promise<Group> | undefined;

export function loadStreetTree() {
  return tree ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync("/models/city/street-tree.glb")
    .then(({ scene }) => scene).catch((error: unknown) => {
      tree = undefined;
      throw error;
    });
}
