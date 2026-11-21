import { MathUtils } from "three";
import type { CameraMode, Pose } from "@/types/game";
import { cityPanels, isCityPanel, type CityPanel, type VehicleSelection } from "@/types/vehicle";
import { createCityCrowd } from "./city-crowd";
import { sampleCarTransfer, type CarTransfer } from "./city-car-transfer";
import { type CityGraphics, cityGraphics, createCityScene } from "./city-scene";
import { placeVehicle, stopVehicle } from "./city-vehicles";
import { cityFootMotion, crossedRed, isDeepWater } from "./city-rules";
import { saveCity, type CitySave } from "./city-save";
import { busRoute, nextTransitStop } from "./city-transit";
import { advanceDrive, createDriveState, type DriveInput, type FreeDriveArea } from "./driving";
import { driveStep } from "./drive-controls";
import { defaultGarage, vehicles } from "./garage";

type Mode = "drive" | "walk" | "swim" | "sit" | "bus" | "train" | "driveBus";
export type CityAction = CityPanel | "exit" | "enter" | "roof" | "boardBus" | "boardTrain"
  | "leaveTransit" | "skip" | "driveBus" | "sit" | "stand";
export interface CityFrame extends Pose {
  speed: number;
  steering: number;
  hour: number;
  mode: Mode;
  violations: number;
  warning: string;
  stamina: number;
  transit: string;
  actions: CityAction[];
  vehicle: VehicleSelection["id"];
  canChooseCar: boolean;
  transferring: boolean;
  panels: Record<CityPanel, boolean>;
  frontLid: boolean;
}

const trainCenterZ = 5.25;
const busStartStop = 2;
const defaultCar = defaultGarage.cars.sedan;
const travelKinds = ["vehicle_spawn", "harbour", "hills", "beach"];

export async function createCitySession(host: HTMLDivElement, saved: CitySave, signal: AbortSignal,
  onHonk: () => void) {
  const world = await createCityScene(host, saved.vehicle, defaultCar, signal);
  const { spawn, cars, places, bus, train } = world;
  const crowd = createCityCrowd(world.scene, world.people, world.traffic, world.height);
  const stations = places.filter(({ kind }) => kind === "station").sort((a, b) => a.z - b.z);
  const benches = places.filter(({ kind }) => kind === "bench");
  if (stations.length < 2) {
    crowd.dispose();
    world.dispose();
    throw new Error("City map requires at least two stations");
  }
  cars[0].pose = { ...spawn };
  const carPose = saved.parkedAt ?? saved.pose;
  if (carPose && !world.blocked(carPose.x, carPose.z) && !isDeepWater(carPose.x, carPose.z)) cars[0].pose = carPose;
  cars[1].pose = { x: 1, z: 97.2, yaw: -Math.PI / 2 };
  if (distance(cars[0].pose, cars[1].pose) < 4) cars[1].pose.x += 8;

  let activeCar = cars[0];
  const walkingPose = saved.parkedAt && saved.pose && !world.blocked(saved.pose.x, saved.pose.z) ? saved.pose : null;
  const player = createDriveState(walkingPose ?? activeCar.pose);
  let mode: Mode = "drive";
  if (walkingPose) mode = isDeepWater(player.x, player.z) ? "swim" : "walk";
  let y = mode === "swim" ? -1.48 : world.height(player.x, player.z);
  let hour = saved.hour;
  let time = 0;
  let violations = saved.violations;
  let warningUntil = 0;
  let stamina = 100;
  let waterAt = 0;
  let stepDebt = 0;
  let paused = false;
  let camera: CameraMode = "Chase";
  let graphics: CityGraphics = "Low";
  let lastSave = 0;
  let footSpeed = 0;
  let reservedCar: typeof activeCar | undefined;
  let sitting: { bench: typeof spawn; standing: Pose; standingY: number; progress: number; rising: boolean } | undefined;
  let transition: (CarTransfer & { started: number; duration: number; car: typeof activeCar; side: number; doorOpen: boolean }) | undefined;
  let blockedExitUntil = 0;
  const busPose = { x: 0, z: 0, yaw: 0 };
  let busDistance = busRoute.stops[busStartStop].at;
  let busStop = busRoute.stops[busStartStop];
  let upcomingBusStop = nextTransitStop(busRoute, busDistance);
  let busDwell = 10;
  let busSpeed = 0;
  let busAtStop = true;
  let busSkip = false;
  let busParked = false;
  const trainPose = { x: stations[0].x, z: stations[0].z, yaw: Math.PI };
  let trainIndex = 0;
  let trainDirection = 1;
  let trainDwell = 10;
  let trainAtStop = true;
  let trainSkip = false;
  busRoute.sample(busDistance, busPose);

  function distance(a: Pose, b: Pose) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }
  function busContains(x: number, z: number) {
    const dx = x - busPose.x;
    const dz = z - busPose.z;
    const sn = Math.sin(busPose.yaw);
    const cs = Math.cos(busPose.yaw);
    return Math.abs(dx * cs - dz * sn) < 1.29 && Math.abs(dx * sn + dz * cs) < 3.69;
  }
  const brakingArea: FreeDriveArea = {
    speedLimit: 14.4,
    blocked(x, z) {
      return world.blocked(x, z) || (mode !== "driveBus" && busContains(x, z)) || crowd.contains(x, z)
        || cars.some((car) => car !== activeCar && (x - car.pose.x) ** 2 + (z - car.pose.z) ** 2 < 1.43 ** 2);
    },
  };
  const busArea: FreeDriveArea = { ...brakingArea, speedLimit: 9.4, body: { width: 2.38, length: 7.24 } };
  function persist() {
    const { x, z, yaw } = player;
    const pose = mode === "train" ? { x: stations[trainIndex].x - 5, z: stations[trainIndex].z, yaw }
      : { x, z, yaw };
    saveCity({ pose, parkedAt: mode === "drive" ? undefined : activeCar.pose, vehicle: activeCar.selection, hour, violations });
  }
  function teleport(pose: Pose) {
    stopVehicle(player, pose);
    y = world.height(pose.x, pose.z);
    stepDebt = 0;
    footSpeed = 0;
  }
  function leaveVehicle(pose: Pose, swim = false, offset = -2.05) {
    const side = { x: pose.x + Math.cos(pose.yaw) * offset, z: pose.z - Math.sin(pose.yaw) * offset, yaw: pose.yaw };
    if (!swim && (world.blocked(side.x, side.z) || isDeepWater(side.x, side.z))) {
      side.x = pose.x - Math.cos(pose.yaw) * offset;
      side.z = pose.z + Math.sin(pose.yaw) * offset;
    }
    teleport(side);
    mode = swim ? "swim" : "walk";
    camera = "Chase";
  }
  function transitDoorOpen() {
    return busAtStop || busParked;
  }
  function nearStation() {
    const current = stations[trainIndex];
    return trainAtStop && Math.abs(player.x - (current.x - 5)) < 6.8 && Math.abs(player.z - current.z) < 12;
  }
  function nearbyBench() {
    return benches.find((bench) => distance(bench, player) < 1.85);
  }
  function nearestCar() {
    if (reservedCar && distance(player, reservedCar.pose) < 3.9 && !isDeepWater(reservedCar.pose.x, reservedCar.pose.z)) {
      return reservedCar;
    }
    let closest: typeof activeCar | undefined;
    let reach = 3.9;
    for (const car of cars) {
      const gap = distance(player, car.pose);
      if (gap >= reach || isDeepWater(car.pose.x, car.pose.z)) continue;
      closest = car;
      reach = gap;
    }
    return closest;
  }
  function driverSeat(car: typeof activeCar, ground: number) {
    const { pose, driverSide, seatZ } = car;
    const sn = Math.sin(pose.yaw);
    const cs = Math.cos(pose.yaw);
    const seatX = driverSide * Math.min(0.36, car.width * 0.22);
    return { x: pose.x + cs * seatX + sn * seatZ, z: pose.z - sn * seatX + cs * seatZ,
      yaw: pose.yaw, y: ground + car.seatedOffset };
  }
  function openCabin(car: typeof activeCar) {
    return vehicles[car.selection.id].roof !== undefined && !car.selection.roof;
  }
  function transferCar(car: typeof activeCar, entering: boolean) {
    const { pose, driverSide } = car;
    const sn = Math.sin(pose.yaw);
    const cs = Math.cos(pose.yaw);
    const ground = world.height(pose.x, pose.z);
    const beside = (x: number, z: number) => ({ x: pose.x + cs * x + sn * z, z: pose.z - sn * x + cs * z });
    const reach = car.width / 2 + 0.9;
    const sides = [driverSide, -driverSide];
    const playerSide = Math.sign((player.x - pose.x) * cs - (player.z - pose.z) * sn);
    if (entering && playerSide === -driverSide) sides.reverse();
    for (const side of sides) {
      const outside = beside(side * reach, car.seatZ + 0.3);
      if (world.blocked(outside.x, outside.z) || isDeepWater(outside.x, outside.z) || busContains(outside.x, outside.z)
        || cars.some((other) => other !== car && distance(other.pose, { ...outside, yaw: 0 }) < 1.55)) continue;
      const sill = beside(side * (car.width / 2 + 0.33), car.seatZ);
      if (world.blocked(sill.x, sill.z) || isDeepWater(sill.x, sill.z)) continue;
      const facingDoor = pose.yaw + side * Math.PI / 2;
      transition = {
        entering, started: time, duration: world.reduced.matches ? 0.01 : 1.38, car, side,
        doorOpen: car.panels[side === driverSide ? "door" : "passengerDoor"],
        start: entering ? { x: player.x, z: player.z, yaw: player.yaw, y }
          : { ...outside, yaw: facingDoor, y: world.height(outside.x, outside.z) },
        sill: { ...sill, yaw: facingDoor, y: ground + 0.07 },
        seat: driverSeat(car, ground),
      };
      camera = "Chase";
      return;
    }
    blockedExitUntil = time + 2.4;
  }
  function finishTransfer(current: NonNullable<typeof transition>) {
    current.car.panels[current.side === current.car.driverSide ? "door" : "passengerDoor"] = false;
    if (current.entering) {
      activeCar = current.car;
      activeCar.panels.trunk = false;
      teleport(activeCar.pose);
      mode = "drive";
    } else {
      teleport({ ...current.start, yaw: current.start.yaw + Math.PI });
      mode = "walk";
    }
    persist();
  }
  function actions(): CityAction[] {
    if (transition) return [];
    if (mode === "sit") return sitting?.progress === 1 && !sitting.rising ? ["stand"] : [];
    if (mode === "driveBus") return Math.abs(player.speed) < 0.2 ? ["exit"] : [];
    if (mode === "drive") {
      if (Math.abs(player.speed) >= 0.2 || waterAt > 0) return [];
      const available: CityAction[] = ["exit", ...availablePanels(activeCar)];
      if (vehicles[activeCar.selection.id].roof !== undefined) available.push("roof");
      return available;
    }
    if (mode === "bus") return transitDoorOpen() ? ["leaveTransit", "skip", "driveBus"] : ["skip"];
    if (mode === "train") return trainAtStop ? ["leaveTransit", "skip"] : ["skip"];
    if (mode === "swim") return [];
    const available: CityAction[] = [];
    const car = nearestCar();
    if (car) {
      available.push("enter", ...availablePanels(car));
    }
    if (transitDoorOpen() && distance(player, busPose) < 9) available.push("boardBus");
    if (nearStation()) available.push("boardTrain");
    if (nearbyBench()) available.push("sit");
    return available;
  }
  function availablePanels(car: typeof activeCar) {
    return cityPanels.filter((panel) => panel !== "rearDoors" || car.hasRearDoors);
  }
  function canChooseCar() {
    return !transition && (mode === "walk" || mode === "drive" && waterAt === 0);
  }
  function updateTransit(dt: number) {
    if (mode === "driveBus") {
      busPose.x = player.x;
      busPose.z = player.z;
      busPose.yaw = player.yaw;
    } else if (!busParked) {
      if (busDwell > 0) busDwell -= dt;
      if (busDwell <= 0) {
        busAtStop = false;
        const next = upcomingBusStop;
        const remaining = busRoute.wrap(next.at - busDistance);
        const red = busRoute.redDistance(busDistance, time);
        const ahead = { x: busPose.x - Math.sin(busPose.yaw) * 4, z: busPose.z - Math.cos(busPose.yaw) * 4, yaw: 0 };
        const blocked = mode === "drive" && distance(player, ahead) < 3.5;
        const target = blocked ? 0 : Math.min(busSkip ? 22 : 8.4, (remaining + 0.7) * 1.5, red);
        busSpeed = MathUtils.damp(busSpeed, target, target < busSpeed ? 5 : 2, dt);
        busDistance = busRoute.wrap(busDistance + Math.min(busSpeed * dt, red, remaining));
        if (remaining <= 0.052 || remaining <= busSpeed * dt && remaining <= red) {
          busStop = next;
          busDistance = next.at;
          upcomingBusStop = nextTransitStop(busRoute, busDistance);
          busDwell = 9;
          busAtStop = true;
          busSkip = false;
          busSpeed = 0;
        }
        busRoute.sample(busDistance, busPose);
      }
    }
    bus.update(busPose, mode === "driveBus" ? y : world.height(busPose.x, busPose.z), transitDoorOpen() && mode !== "driveBus", dt);

    if (trainDwell > 0) trainDwell -= dt;
    if (trainDwell <= 0) {
      trainAtStop = false;
      const next = trainIndex + trainDirection;
      const remaining = Math.abs(stations[next].z - trainPose.z);
      const speed = trainSkip ? 27 : Math.min(13.5, 2.7 + remaining * 1.4);
      trainPose.z += Math.min(remaining, speed * dt) * trainDirection;
      trainPose.yaw = trainDirection > 0 ? Math.PI : 0;
      if (remaining <= speed * dt) {
        trainIndex = next;
        if (next === 0 || next === stations.length - 1) trainDirection *= -1;
        trainAtStop = true;
        trainSkip = false;
        trainDwell = 11;
      }
    }
    train.position.z = trainPose.z - trainCenterZ;
    if (mode === "train") {
      stopVehicle(player, trainPose);
      y = stations[trainIndex].y + 1.2;
    } else if (mode === "bus") {
      stopVehicle(player, busPose);
      y = 1.05;
    }
  }
  function walk(dt: number, movement: { x: number; z: number; run: boolean }) {
    const { x, z, run } = movement;
    const magnitude = Math.min(1, Math.hypot(x, z));
    const fromX = player.x;
    const fromZ = player.z;
    if (magnitude > 0.05) {
      const pace = mode === "swim" ? 1.75 + stamina / 100 : run ? 3.45 : 1.65;
      const angle = Math.atan2(-x, -z);
      const nextX = player.x + Math.sin(-angle) * pace * dt * magnitude;
      const nextZ = player.z - Math.cos(angle) * pace * dt * magnitude;
      if (!world.blocked(nextX, player.z, y) && !busContains(nextX, player.z)) player.x = nextX;
      if (!world.blocked(player.x, nextZ, y) && !busContains(player.x, nextZ)) player.z = nextZ;
    }
    const motion = cityFootMotion(player.x - fromX, player.z - fromZ, player.yaw, dt);
    player.yaw = motion.yaw;
    footSpeed = motion.speed;
    const water = isDeepWater(player.x, player.z);
    mode = water ? "swim" : "walk";
    if (water) {
      stamina = Math.max(0, stamina - dt * (footSpeed > 0.05 ? 2.7 : 0.65));
      y = -1.48 + Math.sin(time * 4) * 0.077;
      if (!stamina) {
        teleport({ x: Math.max(-51, player.x), z: 113, yaw: 0 });
        mode = "walk";
        stamina = 65;
      }
    } else {
      stamina = Math.min(100, stamina + dt * 14);
      y = MathUtils.damp(y, world.height(player.x, player.z, y + 0.86), 13, dt);
    }
  }
  return {
    places, persist,
    pause(next: boolean) { paused = next; if (paused) persist(); },
    setGraphics(next: CityGraphics) { graphics = next; },
    cycleCamera() {
      if (mode !== "drive" && mode !== "driveBus") return;
      const modes: CameraMode[] = ["Chase", "Cabin", "Overhead"];
      camera = modes[(modes.indexOf(camera) + 1) % modes.length];
    },
    rearView() {
      if (mode === "drive" || mode === "driveBus") camera = camera === "Rear" ? "Chase" : "Rear";
    },
    action(value: CityAction) {
      if (!actions().includes(value)) return;
      if (value === "exit" && mode === "driveBus") {
        leaveVehicle(busPose, false, 3);
        busParked = true;
      } else if (value === "exit") {
        transferCar(activeCar, false);
      } else if (value === "enter") {
        const car = nearestCar();
        if (car) transferCar(car, true);
      } else if (isCityPanel(value)) {
        const car = mode === "walk" ? nearestCar() : activeCar;
        if (car) car.panels[value] = !car.panels[value];
      } else if (value === "roof") activeCar.toggleRoof();
      else if (value === "boardBus") {
        mode = "bus";
        camera = "Chase";
      } else if (value === "driveBus") {
        teleport(busPose);
        mode = "driveBus";
        camera = "Chase";
        busAtStop = false;
        busParked = true;
      } else if (value === "boardTrain") {
        mode = "train";
        camera = "Chase";
      } else if (value === "skip" && mode === "train") {
        trainDwell = 0;
        trainSkip = true;
      } else if (value === "skip") {
        busDwell = 0;
        busParked = false;
        busSkip = true;
      } else if (value === "leaveTransit") {
        if (mode === "train") {
          const station = stations[trainIndex];
          teleport({ x: station.x - 5, z: station.z, yaw: Math.PI / 2 });
          mode = "walk";
        } else leaveVehicle(busPose, false, 3);
      } else if (value === "sit") {
        const bench = nearbyBench();
        if (!bench) return;
        const { x, z, yaw } = player;
        sitting = { bench, standing: { x, z, yaw }, standingY: y, progress: 0, rising: false };
        mode = "sit";
        camera = "Chase";
      } else if (value === "stand" && sitting?.progress === 1) {
        const { x, z, yaw } = sitting.bench;
        sitting.standing = { x: x - Math.sin(yaw) * 0.75, z: z - Math.cos(yaw) * 0.75, yaw };
        sitting.standingY = world.height(sitting.standing.x, sitting.standing.z);
        sitting.rising = true;
      }
    },
    async chooseCar(vehicle: VehicleSelection) {
      if (!canChooseCar()) return false;
      const driving = mode === "drive";
      const pose = driving ? { ...activeCar.pose } : [3.6, -3.6, 5.4, -5.4].map((offset) => ({
        x: player.x + Math.cos(player.yaw) * offset, z: player.z - Math.sin(player.yaw) * offset, yaw: player.yaw,
      })).find((candidate) => !brakingArea.blocked(candidate.x, candidate.z) && !isDeepWater(candidate.x, candidate.z)
        && cars.every((car) => car === reservedCar || distance(car.pose, candidate) > 3));
      if (!pose) return false;
      const current = driving ? activeCar : reservedCar;
      if (current && current.selection.id === vehicle.id && current.selection.color === vehicle.color && current.selection.roof === vehicle.roof) {
        current.pose = pose;
        return true;
      }
      const car = await world.addCar(vehicle, pose);
      if (driving) {
        if (reservedCar === activeCar) reservedCar = undefined;
        activeCar = car;
        teleport(pose);
        persist();
      } else reservedCar = car;
      if (current && current !== activeCar) world.removeCar(current);
      return true;
    },
    travel(index: number) {
      const target = places.find(({ kind }) => kind === travelKinds[index]) ?? spawn;
      const pose = index === 3 ? { x: target.x, z: 95, yaw: -Math.PI / 2 } : target;
      mode = "drive";
      camera = "Chase";
      waterAt = 0;
      transition = undefined;
      sitting = undefined;
      teleport(pose);
      activeCar.pose = { ...pose };
      persist();
    },
    tick(input: DriveInput, movement: { x: number; z: number; run: boolean }, dt: number) {
      if (!paused) {
        time += dt;
        hour = (hour + dt / 23) % 24;
        if (transition) {
          if (time >= transition.started + transition.duration) {
            finishTransfer(transition);
            transition = undefined;
          }
        } else if (mode === "drive" || mode === "driveBus") {
          const { x, z, speed } = player;
          stepDebt += dt;
          while (stepDebt >= driveStep) {
            advanceDrive(player, input, mode === "drive" ? brakingArea : busArea, driveStep, 0, activeCar.selection.id);
            stepDebt -= driveStep;
          }
          if (crossedRed(x, z, player.x, player.z, time)) {
            violations = Math.min(Number.MAX_SAFE_INTEGER, violations + 1);
            warningUntil = time + 3.2;
          }
          if (Math.abs(player.speed) > 0.4) {
            activeCar.panels.door = false;
            activeCar.panels.passengerDoor = false;
            activeCar.panels.rearDoors = false;
          }
          const wet = isDeepWater(player.x, player.z);
          y = wet ? -1.07 : world.height(player.x, player.z);
          if (mode === "drive") {
            const direction = Math.sign(player.speed) || Math.sign(speed);
            activeCar.updateWheels(Math.hypot(player.x - x, player.z - z) * direction, player.steering);
            activeCar.pose.x = player.x;
            activeCar.pose.z = player.z;
            activeCar.pose.yaw = player.yaw;
          }
          waterAt = wet ? waterAt + dt : 0;
          if (waterAt > 1.3) {
            leaveVehicle(player, true);
            waterAt = 0;
          }
        } else if (mode === "walk" || mode === "swim") walk(dt, movement);
        else if (mode === "sit" && sitting) {
          const { bench, standing, standingY, rising } = sitting;
          sitting.progress = MathUtils.clamp(sitting.progress + (rising ? -2 : 2) * dt, 0, 1);
          const t = MathUtils.smoothstep(sitting.progress, 0, 1);
          player.x = MathUtils.lerp(standing.x, bench.x, t);
          player.z = MathUtils.lerp(standing.z, bench.z, t);
          const turn = bench.yaw - standing.yaw;
          player.yaw = standing.yaw + Math.atan2(Math.sin(turn), Math.cos(turn)) * t;
          y = MathUtils.lerp(standingY, bench.y - 0.05, t);
          if (rising && sitting.progress === 0) {
            sitting = undefined;
            mode = "walk";
          }
        }
        updateTransit(dt);
        if (time - lastSave > 4) {
          persist();
          lastSave = time;
        }
      }
      const progress = transition ? (time - transition.started) / transition.duration : 0;
      const transfer = transition && sampleCarTransfer(transition, progress);
      for (const car of cars) {
        const { pose } = car;
        const carY = car === activeCar && mode === "drive" ? y : isDeepWater(pose.x, pose.z) ? -3.5 : world.height(pose.x, pose.z);
        placeVehicle(car.root, pose, carY);
        car.update(dt, world.reduced.matches, transition?.car === car && transfer
          ? { side: transition.side, door: transition.doorOpen && progress < 0.35 ? 1 : transfer.door } : undefined);
      }
      const onFoot = mode === "walk" || mode === "swim";
      const preset = cityGraphics[graphics];
      if (!paused) {
        const seat = mode === "drive" && openCabin(activeCar) && camera !== "Cabin" && camera !== "Rear"
          ? driverSeat(activeCar, y) : null;
        const transferAvatar = transfer && transition && (transfer.seated < 0.995 || openCabin(transition.car))
          ? { ...transfer, y: transfer.pose.y, swimming: false } : null;
        const standingAvatar = onFoot && !transfer ? { y, speed: footSpeed, swimming: mode === "swim" } : null;
        const seatedAvatar = seat && !transfer ? { pose: seat, y: seat.y, seated: 1, swimming: false } : null;
        const benchAvatar = mode === "sit" && sitting ? { y, seated: MathUtils.smoothstep(sitting.progress, 0.18, 1),
          swimming: false } : null;
        crowd.update(player, dt, time, preset.traffic, preset.people, preset.distance, onHonk,
          transferAvatar ?? standingAvatar ?? seatedAvatar ?? benchAvatar);
      }
      const height = mode === "drive" ? activeCar.height : mode === "driveBus" ? 2.38 : 1.55;
      world.render(onFoot ? { ...player, yaw: 0 } : player, y, camera, mode === "drive" || mode === "driveBus" ? y + height : height, graphics, hour,
        time, dt, time % 168 > 128, mode === "swim", mode === "train",
        transition && !world.reduced.matches ? { ...transition.car.pose, side: transition.side, blend: Math.sin(Math.PI * progress) } : undefined);
    },
    frame(): CityFrame {
      const car = (mode === "walk" ? nearestCar() : activeCar) ?? activeCar;
      return {
        x: player.x, z: player.z, yaw: player.yaw, speed: player.speed, steering: player.steering, mode, hour, violations, stamina,
        warning: warningUntil > time ? "Red light violation" : waterAt > 0 ? "Deep water · Leave the vehicle"
          : blockedExitUntil > time ? "There’s no room beside the car." : "",
        transit: mode === "train" ? stations[trainAtStop ? trainIndex : trainIndex + trainDirection].name
          : mode === "bus" ? (busAtStop ? busStop : upcomingBusStop).name : "",
        actions: actions(), vehicle: activeCar.selection.id, canChooseCar: canChooseCar(), transferring: Boolean(transition),
        panels: { ...car.panels }, frontLid: car.frontLid,
      };
    },
    dispose() {
      persist();
      crowd.dispose();
      world.dispose();
    },
  };
}
