import * as THREE from "three";
import type { Pose } from "@/types/game";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { createCityAvatar, createPedestrian, type CityPersonPose } from "./city-people";
import { defaultGarage } from "./garage";
import { buildPlayerVehicle, loadPlayerVehicle } from "./player-vehicle";
import { cityFootMotion, junctions, trafficSignal } from "./city-rules";
import { trafficRoutes } from "./city-transit";
import { createVehicleWheels } from "./vehicle-wheels";

const trafficRoster = ["hatch", "sedan", "suv"] as const;

export function loadCityTraffic(renderer: THREE.WebGLRenderer) {
  return Promise.all(trafficRoster.map((id) => loadPlayerVehicle(id, renderer)));
}

export function createCityCrowd(scene: THREE.Scene, [hero, characters]: readonly [GLTF, GLTF[]], cars: THREE.Object3D[],
  groundHeight: (x: number, z: number) => number) {
  const birdGeometry = new THREE.PlaneGeometry(1, 1);
  const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x34454a, side: THREE.DoubleSide });
  const birds = new THREE.InstancedMesh(birdGeometry, birdMaterial, 12);
  birds.frustumCulled = false;
  birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(birds);
  const avatar = createCityAvatar(hero);
  scene.add(avatar.root);
  const actor = new THREE.Object3D();
  const part = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  const traffic = Array.from({ length: 12 }, (_, index) => {
    const route = trafficRoutes[index % trafficRoutes.length];
    const distance = (Math.floor(index / trafficRoutes.length) + 0.36) / 4 * route.length;
    const pose = { x: 0, z: 0, yaw: 0 };
    route.sample(distance, pose);
    const variant = Math.floor(index / trafficRoutes.length + index) % trafficRoster.length;
    const id = trafficRoster[variant];
    const model = buildPlayerVehicle(cars[variant], id);
    model.customize(defaultGarage.cars[id]);
    model.root.visible = false;
    scene.add(model.root);
    return { route, distance, pose, speed: 0, model, wheels: createVehicleWheels(model.root, "") };
  });
  const pedestrians = Array.from({ length: 17 }, (_, index) => {
    const junction = junctions[index % junctions.length];
    const side = index % 2 === 0 ? 1 : -1;
    const model = createPedestrian(characters[index % characters.length], index * 0.22);
    scene.add(model.root);
    return {
      junction, side, phase: index * 4.6, direction: index % 3 === 0 ? -1 : 1,
      crossing: index >= 3 && index % 4 === 0, boulevard: index < 3, model,
      pose: { x: 0, z: 0, yaw: 0 }, tracked: false, y: 0.19, groundY: 0.19, nextHeight: 0,
      dodge: 0, crossingPosition: 0,
    };
  });
  let honkAt = 0;
  let lastTrafficCount = 0;

  function wing(side: number, swing: number) {
    part.position.set(side * 0.31, 0, 0);
    part.scale.set(0.64, 0.16, 1);
    part.rotation.set(swing, 0, 0);
    part.updateMatrix();
    matrix.multiplyMatrices(actor.matrix, part.matrix);
    birds.setMatrixAt(birds.count++, matrix);
  }

  return {
    contains(x: number, z: number) {
      return traffic.slice(0, lastTrafficCount).some(({ pose }) =>
        (x - pose.x) ** 2 + (z - pose.z) ** 2 < 1.3 ** 2);
    },
    update(pose: Pose, dt: number, time: number, trafficCount: number, peopleCount: number,
      range: number, onHonk: () => void, player: CityPersonPose | null) {
      birds.count = 0;
      for (const { model } of traffic) model.root.visible = false;
      for (const { model } of pedestrians) model.root.visible = false;
      avatar.root.visible = false;
      lastTrafficCount = trafficCount;
      const playerOnFoot = player && player.seated !== 1;
      for (let index = 0; index < trafficCount; index++) {
        const vehicle = traffic[index];
        const { route, pose: car } = vehicle;
        const signalDistance = route.redDistance(vehicle.distance, time);
        const sqDistance = (car.x - pose.x) ** 2 + (car.z - pose.z) ** 2;
        const nextX = car.x - Math.sin(car.yaw) * 3.4;
        const nextZ = car.z - Math.cos(car.yaw) * 3.4;
        const playerBlocking = !playerOnFoot && (nextX - pose.x) ** 2 + (nextZ - pose.z) ** 2 < 3.9 ** 2;
        const carBlocking = traffic.slice(0, trafficCount).some((other) => other !== vehicle
          && (other.pose.x - nextX) ** 2 + (other.pose.z - nextZ) ** 2 < 2.55 ** 2);
        if (playerBlocking && time > honkAt) {
          onHonk();
          honkAt = time + 7;
        }
        const target = playerBlocking || carBlocking ? 0 : Math.min(7.2, signalDistance * 0.86);
        vehicle.speed = THREE.MathUtils.damp(vehicle.speed, target, target < vehicle.speed ? 5 : 2, dt);
        const step = Math.min(vehicle.speed * dt, signalDistance);
        vehicle.distance = route.wrap(vehicle.distance + step);
        route.sample(vehicle.distance, car);
        if (sqDistance > range * range) continue;
        vehicle.model.root.visible = true;
        vehicle.model.root.position.set(car.x, 0.02, car.z);
        vehicle.model.root.rotation.y = car.yaw;
        vehicle.wheels(step, 0);
      }
      for (let index = 0; index < peopleCount; index++) {
        const walker = pedestrians[index];
        const { junction, phase, direction } = walker;
        const elapsed = time + phase;
        const sine = Math.sin(elapsed * 0.063);
        const signalOffset = junctions.indexOf(junction) * 4;
        if (walker.crossing) {
          const progress = walker.crossingPosition;
          if (progress > 0 || trafficSignal(time, "z", signalOffset) === "green") {
            walker.crossingPosition = progress + dt * 0.078;
            if (walker.crossingPosition >= 1) {
              walker.crossingPosition = 0;
              walker.side *= -1;
            }
          }
        }
        const { side } = walker;
        const sx = walker.boulevard ? -10 + sine * (17 + index * 5)
          : junction.x + (walker.crossing ? side * (9 - walker.crossingPosition * 18) : 8.15 * side);
        const sz = walker.boulevard ? 101.6 + index * 1.45
          : junction.z + (walker.crossing ? -8.7 : 15 + sine * 14) * direction;
        const d = (sx - pose.x) ** 2 + (sz - pose.z) ** 2;
        walker.dodge = THREE.MathUtils.damp(walker.dodge, !playerOnFoot && d < 3.6 ** 2 ? 2.7 : 0, 5, dt);
        const alongStreet = walker.boulevard || walker.crossing;
        const x = sx + (alongStreet ? 0 : side * walker.dodge);
        const z = sz + (alongStreet ? direction * walker.dodge : 0);
        const { speed, yaw } = cityFootMotion(walker.tracked ? x - walker.pose.x : 0,
          walker.tracked ? z - walker.pose.z : 0, walker.pose.yaw, dt);
        walker.tracked = true;
        walker.pose.x = x;
        walker.pose.z = z;
        walker.pose.yaw = yaw;
        if (d > range * range * 0.48) continue;
        if (time >= walker.nextHeight) {
          walker.groundY = groundHeight(x, z);
          walker.nextHeight = time + 0.16 + index * 0.005;
        }
        walker.y = THREE.MathUtils.damp(walker.y, walker.groundY, 14, dt);
        walker.model.place(walker.pose, walker.y, speed, dt);
      }
      if (player) avatar.place(player.pose ?? pose, player, time, dt);
      for (let index = 0; index < 6; index++) {
        const angle = time * 0.16 + index * 0.22;
        actor.position.set(Math.sin(angle) * 60, 22 + Math.sin(index + time) * 1.5, 71 + Math.cos(angle) * 44);
        actor.rotation.set(-Math.PI / 2, 0, -angle);
        actor.updateMatrix();
        const flap = Math.sin(time * 7 + index) * 0.25;
        for (const side of [-1, 1]) wing(side, flap * side);
      }
      birds.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      avatar.dispose();
      for (const { model } of pedestrians) model.dispose();
      for (const { model } of traffic) {
        model.root.removeFromParent();
        model.dispose();
      }
      birds.dispose();
      birdGeometry.dispose();
      birdMaterial.dispose();
      birds.removeFromParent();
    },
  };
}
