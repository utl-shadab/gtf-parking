import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { buildPlayerVehicle, loadPlayerVehicle } from "./player-vehicle";
import { vehicles } from "./garage";
import type { Pose } from "@/types/game";
import type { CityPanel, VehicleSelection } from "@/types/vehicle";
import type { DriveState } from "./driving";
import { createVehicleWheels } from "./vehicle-wheels";

export async function createCityCar(selection: VehicleSelection, pose: Pose, renderer: THREE.WebGLRenderer) {
  const model = buildPlayerVehicle(await loadPlayerVehicle(selection.id, renderer), selection.id);
  model.customize(selection);
  const joints = new Map<string, THREE.Object3D>();
  model.root.traverse((object) => {
    const name = typeof object.userData.name === "string" ? object.userData.name : object.name;
    if (name === "boot" || /^door_[FR][LR]$/.test(name)) joints.set(name, object);
  });
  function hinge(name: string, axis: "x" | "y", angle: number) {
    const joint = joints.get(name);
    if (!joint) return;
    const pivot = joint.getWorldPosition(new THREE.Vector3());
    const openAxis = joint.userData.open_axis === "y" ? "y" : axis;
    const openAngle = typeof joint.userData.open_angle === "number" ? joint.userData.open_angle : angle;
    const authored: unknown = joint.userData.open_rotation;
    const rotation = new THREE.Vector3();
    rotation[openAxis] = openAngle;
    if (Array.isArray(authored) && authored.length === 3 && authored.every(Number.isFinite)) {
      rotation.fromArray(authored);
    }
    const rest = joint.quaternion.clone();
    const target = new THREE.Quaternion();
    const euler = new THREE.Euler();
    return {
      pivot,
      frontLid: joint.userData.front_lid === true,
      move(amount: number, alpha: number) {
        euler.set(rotation.x * amount, rotation.y * amount, rotation.z * amount);
        target.setFromEuler(euler).premultiply(rest);
        joint.quaternion.slerp(target, alpha);
      },
    };
  }
  const door = hinge("door_FL", "y", -1.05);
  const passengerDoor = hinge("door_FR", "y", 1.05);
  const rearLeft = hinge("door_RL", "y", -0.97);
  const rearRight = hinge("door_RR", "y", 0.97);
  const trunk = hinge("boot", "x", -0.94);
  if (!door || !passengerDoor || !trunk) {
    model.dispose();
    throw new Error(`Vehicle hinges missing for ${selection.id}`);
  }
  const driverSide = door.pivot.x > 0 ? 1 : -1;
  const panels: Record<CityPanel, boolean> = { door: false, passengerDoor: false, rearDoors: false, trunk: false };
  const wheelSuffix = vehicles[selection.id].asset.startsWith("traffic-pack") ? `_${selection.id}` : "";
  return {
    root: model.root,
    selection,
    pose,
    panels,
    hasRearDoors: Boolean(rearLeft && rearRight),
    frontLid: trunk.frontLid,
    height: vehicles[selection.id].driverHeight ?? model.size.y * 0.86,
    seatedOffset: model.size.y * 0.85 - 1.25,
    width: model.size.x,
    driverSide,
    seatZ: door.pivot.z + 0.54,
    updateWheels: createVehicleWheels(model.root, wheelSuffix),
    update(dt: number, reducedMotion: boolean, transfer?: { side: number; door: number }) {
      const alpha = reducedMotion ? 1 : 1 - Math.exp(-9 * dt);
      const movingDriverDoor = transfer?.side === driverSide;
      door.move(movingDriverDoor ? transfer.door : Number(panels.door), movingDriverDoor ? 1 : alpha);
      const movingPassengerDoor = transfer && !movingDriverDoor;
      passengerDoor.move(movingPassengerDoor ? transfer.door : Number(panels.passengerDoor), movingPassengerDoor ? 1 : alpha);
      rearLeft?.move(Number(panels.rearDoors), alpha);
      rearRight?.move(Number(panels.rearDoors), alpha);
      trunk.move(Number(panels.trunk), alpha);
    },
    toggleRoof() {
      selection.roof = !selection.roof;
      model.customize(selection);
    },
    dispose: model.dispose,
  };
}

export function createCityBus() {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const busBody = new RoundedBoxGeometry(2.36, 1.05, 7.19, 2, 0.20);
  const busRoof = new RoundedBoxGeometry(2.31, 0.29, 7.10, 2, 0.12);
  const busVent = new RoundedBoxGeometry(1.08, 0.16, 2.15, 2, 0.07);
  const tire = new THREE.CylinderGeometry(0.43, 0.43, 0.28, 22);
  const wheelRim = new THREE.CylinderGeometry(0.285, 0.285, 0.31, 10);
  const paint = new THREE.MeshStandardMaterial({ color: 0x177265, metalness: 0.27, roughness: 0.38 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe3e1d5, metalness: 0.18, roughness: 0.37 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x264653, metalness: 0.18, roughness: 0.18, transparent: true, opacity: 0.74 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x171e22, roughness: 0.82 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x263943, roughness: 0.49 });
  const seats = new THREE.MeshStandardMaterial({ color: 0x456681, roughness: 0.92 });
  const marker = new THREE.MeshStandardMaterial({ color: 0xfff8e4, emissive: 0xffddb1, emissiveIntensity: 0.48 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xd33327, emissive: 0xb82c21, emissiveIntensity: 0.3 });
  function panel(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    root.add(mesh);
    return mesh;
  }
  for (const [shape, material, y, z] of [[busBody, paint, 0.95, 0], [busRoof, trim, 2.62, 0], [busVent, trim, 2.80, 0.58]] as const) {
    const mesh = new THREE.Mesh(shape, material);
    mesh.position.set(0, y, z);
    root.add(mesh);
  }
  panel(frame, 0, 1.18, 0, 2.11, 0.13, 6.70);
  panel(frame, 0, 1.51, -3.49, 2.17, 0.17, 0.18);
  panel(frame, 0, 2.48, -3.49, 2.18, 0.19, 0.16);
  panel(glass, 0, 1.98, -3.50, 2.12, 0.96, 0.105).rotation.x = -0.07;
  panel(frame, 0, 1.98, -3.57, 0.063, 0.94, 0.045);
  panel(frame, 0, 1.92, 3.46, 2.19, 1.03, 0.10);
  panel(glass, 0, 2.04, 3.55, 1.89, 0.69, 0.061);
  panel(rubber, 0, 0.59, -3.59, 2.29, 0.18, 0.13);
  panel(rubber, 0, 0.56, 3.60, 2.21, 0.17, 0.11);
  panel(rubber, 0, 0.83, -3.60, 1.17, 0.15, 0.075);
  const wheels: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const x = side * 1.164;
    panel(trim, x, 1.38, 0, 0.07, 0.12, 7.04);
    panel(frame, x, 2.45, 0, 0.082, 0.083, 7.03);
    panel(frame, x, 1.54, 0, 0.08, 0.13, 7.03);
    for (const z of [-3.44, -2.98, -1.70, -0.33, 1.02, 2.37, 3.48]) panel(frame, x, 1.98, z, 0.08, 0.93, 0.098);
    for (const z of [-1.02, 0.34, 1.69, 2.92]) {
      panel(glass, x, 1.98, z, 0.042, 0.82, 1.18);
      panel(seats, side * 0.73, 1.48, z + 0.23, 0.43, 0.11, 0.44);
      panel(seats, side * 0.73, 1.72, z + 0.42, 0.43, 0.49, 0.10);
    }
    if (side < 0) panel(glass, x, 1.98, -2.34, 0.045, 0.85, 1.27);
    panel(frame, side * 1.27, 2.04, -3.38, 0.14, 0.075, 0.24);
    panel(rubber, side * 1.32, 1.98, -3.31, 0.13, 0.25, 0.18);
    for (const z of [-2.22, 2.24]) {
      const axle = new THREE.Group();
      const wheel = new THREE.Mesh(tire, rubber);
      const rim = new THREE.Mesh(wheelRim, trim);
      wheel.rotation.z = Math.PI / 2;
      rim.rotation.z = Math.PI / 2;
      axle.add(wheel, rim);
      axle.position.set(side * 1.035, 0.435, z);
      root.add(axle);
      wheels.push(axle);
    }
    panel(marker, side * 0.867, 0.99, -3.604, 0.39, 0.18, 0.07);
    panel(tail, side * 0.94, 1.06, 3.60, 0.16, 0.37, 0.065);
  }
  const doors = [-2.69, -2.05].map((z) => {
    const panelRoot = new THREE.Group();
    panelRoot.position.z = z;
    panelRoot.add(panel(frame, 1.171, 1.22, 0, 0.09, 1.69, 0.59));
    panelRoot.add(panel(glass, 1.227, 1.54, 0, 0.027, 0.94, 0.47));
    root.add(panelRoot);
    return { panelRoot, z };
  });
  const destination = document.createElement("canvas");
  destination.width = 256;
  destination.height = 48;
  const context = destination.getContext("2d");
  if (context) {
    context.fillStyle = "#131c1a";
    context.fillRect(0, 0, 256, 48);
    context.fillStyle = "#ffd981";
    context.font = "700 26px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("01  BAY SHUTTLE", 128, 25);
  }
  const destinationMap = new THREE.CanvasTexture(destination);
  destinationMap.colorSpace = THREE.SRGBColorSpace;
  const boardGeometry = new THREE.PlaneGeometry(1.93, 0.33);
  const boardMaterial = new THREE.MeshBasicMaterial({ map: destinationMap });
  const board = new THREE.Mesh(boardGeometry, boardMaterial);
  board.rotation.y = Math.PI;
  board.position.set(0, 2.43, -3.596);
  root.add(board);
  let previous: { x: number; z: number } | undefined;
  return {
    root,
    update(pose: Pose, y: number, open: boolean, dt: number) {
      if (previous) {
        const distance = (previous.x - pose.x) * Math.sin(pose.yaw) + (previous.z - pose.z) * Math.cos(pose.yaw);
        for (const wheel of wheels) wheel.rotation.x = (wheel.rotation.x - distance / 0.43) % (Math.PI * 2);
        previous.x = pose.x;
        previous.z = pose.z;
      } else previous = { x: pose.x, z: pose.z };
      placeVehicle(root, pose, y);
      doors.forEach(({ panelRoot, z }, index) => {
        panelRoot.position.z = THREE.MathUtils.damp(panelRoot.position.z, z + (open ? (index ? 0.54 : -0.54) : 0), 8, dt);
      });
    },
    dispose() {
      for (const shape of [geometry, busBody, busRoof, busVent, tire, wheelRim, boardGeometry]) shape.dispose();
      destinationMap.dispose();
      for (const material of [paint, trim, glass, rubber, marker, tail, frame, seats, boardMaterial]) material.dispose();
    },
  };
}

export function placeVehicle(root: THREE.Object3D, pose: Pose, y: number) {
  root.position.set(pose.x, y, pose.z);
  root.rotation.y = pose.yaw;
}

export function stopVehicle(state: DriveState, pose: Pose) {
  state.x = pose.x;
  state.z = pose.z;
  state.yaw = pose.yaw;
  state.speed = 0;
  state.steering = 0;
}
