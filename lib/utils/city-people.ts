import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { Pose } from "@/types/game";

const pedestrians = ["casual-man", "casual-woman", "business-man", "business-woman"] as const;
type Motion = "Idle" | "Walk" | "Run";

export interface CityPersonPose {
  pose?: Pose;
  y: number;
  stride?: number;
  seated?: number;
  reach?: number;
  speed?: number;
  swimming: boolean;
}

let peopleRequest: ReturnType<typeof requestPeople> | undefined;

function requestPeople() {
  const loader = new GLTFLoader();
  const load = (name: string) => loader.loadAsync(`/models/people/${name}.glb`);
  return Promise.all([load("jinu"), Promise.all(pedestrians.map(load))]);
}

export function loadCityPeople() {
  return peopleRequest ??= requestPeople().catch((error: unknown) => {
    peopleRequest = undefined;
    throw error;
  });
}

function createBody(asset: GLTF, height?: number) {
  const body = clone(asset.scene);
  body.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(body, true);
  const size = bounds.getSize(new THREE.Vector3());
  const root = new THREE.Group();
  const facing = new THREE.Group();
  body.position.y -= bounds.min.y;
  facing.rotation.y = Math.PI;
  facing.scale.setScalar(height ? height / size.y : 1);
  facing.add(body);
  root.add(facing);
  const skeletons = new Set<THREE.Skeleton>();
  body.traverse((node) => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    node.frustumCulled = false;
    skeletons.add(node.skeleton);
  });
  root.updateMatrixWorld(true);
  return {
    root,
    body,
    dispose() {
      root.removeFromParent();
      skeletons.forEach((skeleton) => skeleton.dispose());
    },
  };
}

function animateLocomotion(asset: GLTF, body: THREE.Object3D, phase: number) {
  const mixer = new THREE.AnimationMixer(body);
  const actions = new Map(asset.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  let current: THREE.AnimationAction | undefined;
  return {
    update(speed: number, dt: number) {
      const motion: Motion = speed < 0.13 ? "Idle" : speed > 2.2 ? "Run" : "Walk";
      const action = actions.get(motion);
      if (action && action !== current) {
        const cycle = current ? current.time / current.getClip().duration : phase;
        action.reset();
        action.time = (cycle % 1) * action.getClip().duration;
        action.play();
        if (current) action.crossFadeFrom(current, 0.2, false);
        current = action;
      }
      const strideSpeed = motion === "Run" ? 3.4 : 1.45;
      action?.setEffectiveTimeScale(motion === "Idle" ? 1 : speed / strideSpeed);
      mixer.update(dt);
    },
    stop() {
      if (!current) return;
      mixer.stopAllAction();
      current = undefined;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(body);
    },
  };
}

export function createPedestrian(asset: GLTF, phase: number) {
  const { root, body, dispose } = createBody(asset);
  const animation = animateLocomotion(asset, body, phase);
  root.visible = false;
  return {
    root,
    place(pose: Pose, y: number, speed: number, dt: number) {
      root.visible = true;
      root.position.set(pose.x, y, pose.z);
      root.rotation.y = pose.yaw;
      animation.update(speed, dt);
    },
    dispose() {
      animation.dispose();
      dispose();
    },
  };
}

export function createCityAvatar(asset: GLTF) {
  const { root, body, dispose } = createBody(asset, 1.77);
  const animation = animateLocomotion(asset, body, 0);
  const axis = new THREE.Vector3(1, 0, 0);
  const turn = new THREE.Quaternion();
  function joint(prefix: string) {
    let match: THREE.Bone | undefined;
    body.traverse((node) => {
      if (node instanceof THREE.Bone && node.name.startsWith(prefix)) match ??= node;
    });
    if (!match) throw new Error(`Jinu is missing the ${prefix} joint`);
    const bone = match;
    const axisLocal = axis.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
    const rest = bone.quaternion.clone();
    return (angle: number) => bone.quaternion.copy(rest).multiply(turn.setFromAxisAngle(axisLocal, angle));
  }
  const spine = joint("spine_02_");
  const limbs = ["l", "r"].map((side) => ({
    thigh: joint(`thigh_${side}_`), calf: joint(`calf_${side}_`),
    arm: joint(`upperarm_${side}_`), forearm: joint(`lowerarm_${side}_`),
  }));
  root.visible = false;
  return {
    root,
    dispose() {
      animation.dispose();
      dispose();
    },
    place(pose: Pose, avatar: CityPersonPose, time: number, dt: number) {
      const seated = avatar.seated ?? 0;
      root.visible = true;
      if (!avatar.swimming && avatar.stride === undefined && avatar.seated === undefined) {
        root.position.set(pose.x, avatar.y, pose.z);
        root.rotation.set(0, pose.yaw, 0);
        animation.update(avatar.speed ?? 0, dt);
        return;
      }
      animation.stop();
      const gait = avatar.stride ?? ((avatar.speed ?? 0) > 0.1 ? Math.sin(time * 7) * 0.34 : 0);
      const reach = avatar.reach ?? 0;
      root.position.set(pose.x, avatar.y - seated * 0.43 + Math.abs(gait) * 0.036, pose.z);
      root.rotation.set(avatar.swimming ? -1.23 : 0, pose.yaw, 0, "YXZ");
      spine(avatar.swimming ? -0.08 : -0.28 * (seated + reach * 0.4) - Math.abs(gait) * 0.10);
      limbs.forEach(({ thigh, calf, arm, forearm }, index) => {
        const step = gait * (index === 0 ? 1 : -1);
        thigh(step * (1 - seated) + seated * 1.5);
        calf(-Math.max(0, -step) * 1.18 - seated * 1.48);
        const hand = index === 0 ? reach : reach * 0.18;
        arm(-step * 0.74 + hand * 0.72 + seated * 0.52);
        forearm(0.11 + Math.abs(step) * 0.21 + seated * 0.75 + hand * 0.22);
      });
    },
  };
}
