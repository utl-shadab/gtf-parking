import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { CameraMode, Pose } from "@/types/game";
import type { VehicleSelection } from "@/types/vehicle";
import { createCabinCameras } from "./cabin-cameras";
import { createCityBus, createCityCar } from "./city-vehicles";
import { trafficSignal, insideCity, isDeepWater, junctions } from "./city-rules";
import { loadCityPeople } from "./city-people";
import { loadCityTraffic } from "./city-crowd";
import { loadStreetTree } from "./street-tree";
import { addSeaWaves, createCityTrees, fitCityMaterial, loadCityTextures } from "./city-scenery";

export interface CityPlace extends Pose {
  name: string;
  kind: string;
  y: number;
}

export type CityGraphics = "Low" | "Medium" | "High";
export const cityGraphics = {
  Low: { distance: 110, pixels: 1, traffic: 4, people: 5, trees: 7, shadow: false },
  Medium: { distance: 145, pixels: 1.35, traffic: 9, people: 11, trees: 12, shadow: true },
  High: { distance: 220, pixels: 1.75, traffic: 12, people: 17, trees: 16, shadow: true },
} satisfies Record<CityGraphics, { distance: number; pixels: number; traffic: number; people: number; trees: number; shadow: boolean }>;

const solidBuilding = /^(Restaurant ·|Café ·|House ·|Shop ·|Service station shop|Parkline multi-storey garage|(?:West Market|Marina Offices|Maple Row|Civic Quarter|Juniper Heights) · \d)/;
const walkable = /^(City Ground|Street -?\d|Avenue |Block foundation|Juniper Ridge terrain|Ridge Drive|.* rail platform and stairs)/;
const sunColor = new THREE.Color(0xffdfae);
const nightColor = new THREE.Color(0x91a8d8);
const daySky = new THREE.Color(0x8cbfdc);
const duskSky = new THREE.Color(0xeab481);
const nightSky = new THREE.Color(0x26344b);
const blueSky = new THREE.Color(0x487eac);

function authoredName(object: THREE.Object3D | null) {
  return object && (typeof object.userData.name === "string" ? object.userData.name : object.name) || "";
}

async function loadCity() {
  const decoder = new DRACOLoader().setDecoderPath("/draco/").setWorkerLimit(2);
  try {
    return (await new GLTFLoader().setDRACOLoader(decoder).loadAsync("/models/city/open-city.glb")).scene;
  } finally {
    decoder.dispose();
  }
}

function disposeCity(map: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  map.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export async function createCityScene(host: HTMLDivElement, selection: VehicleSelection, parked: VehicleSelection, signal: AbortSignal) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  const origin = { x: 0, z: 0, yaw: 0 };
  const results = await Promise.allSettled([
    loadCity(), createCityCar({ ...selection }, { ...origin }, renderer), createCityCar({ ...parked }, { ...origin }, renderer),
    Promise.all([loadCityPeople(), loadCityTraffic(renderer), loadStreetTree(), loadCityTextures()] as const),
  ] as const);
  const [mapResult, carResult, parkedResult, sceneryResult] = results;
  const failure = results.find((result) => result.status === "rejected");
  if (mapResult.status !== "fulfilled" || carResult.status !== "fulfilled" || parkedResult.status !== "fulfilled"
    || sceneryResult.status !== "fulfilled" || signal.aborted) {
    if (mapResult.status === "fulfilled") disposeCity(mapResult.value);
    if (carResult.status === "fulfilled") carResult.value.dispose();
    if (parkedResult.status === "fulfilled") parkedResult.value.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    throw failure?.reason ?? new DOMException("City loading cancelled", "AbortError");
  }
  const map = mapResult.value;
  const [people, traffic, streetTree, surfaceTextures] = sceneryResult.value;
  const cars = [carResult.value, parkedResult.value];
  const bus = createCityBus();
  const scene = new THREE.Scene();
  const sky = new THREE.Color();
  scene.background = sky;
  const fog = new THREE.Fog(sky, 50, 145);
  scene.fog = fog;
  const domeGeometry = new THREE.SphereGeometry(1, 24, 12);
  const zenith = new THREE.Color();
  const domeMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { horizon: { value: sky }, zenith: { value: zenith } },
    vertexShader: `
      varying float altitude;
      void main() {
        altitude = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying float altitude;
      uniform vec3 horizon;
      uniform vec3 zenith;
      void main() {
        gl_FragColor = vec4(mix(horizon, zenith, smoothstep(0.0, 0.68, altitude)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.scale.setScalar(48);
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  scene.add(dome, map, bus.root, ...cars.map(({ root }) => root));
  map.updateMatrixWorld(true);

  const places: CityPlace[] = [];
  const solids: THREE.Box3[] = [];
  const ground: THREE.Mesh[] = [];
  const cameraObstacles: THREE.Mesh[] = [];
  const nightMaterials = new Set<THREE.MeshStandardMaterial>();
  const foamMaterials = new Set<THREE.MeshStandardMaterial>();
  const seaClock = { value: 0 };
  const decorated = new Set<THREE.MeshStandardMaterial>();
  const asphalt = new Set<THREE.MeshStandardMaterial>();
  const foliage = new Set<THREE.MeshStandardMaterial>();
  const wind = { value: 0 };
  const bulbs: { mesh: THREE.Mesh; axis: "x" | "z"; offset: number; color: string }[] = [];
  const signalGeometry = new THREE.BoxGeometry(0.305, 0.258, 0.04);
  const signalMaterials = Object.fromEntries(Object.entries({ red: 0xff3823, amber: 0xffb429, green: 0x46ef9c })
    .map(([key, color]) => [key, new THREE.MeshBasicMaterial({ color })]));
  const signalOff = new THREE.MeshBasicMaterial({ color: 0x21262a });
  const authoredSignals: THREE.Object3D[] = [];
  const vector = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  let train: THREE.Object3D | undefined;
  map.traverse((object) => {
    const name = authoredName(object);
    if (object.userData.kind === "train_vehicle") train = object;
    else if (typeof object.userData.kind === "string") {
      object.getWorldPosition(vector);
      heading.set(0, 0, -1).applyQuaternion(object.getWorldQuaternion(orientation));
      places.push({
        name: name.split(" · ").at(-1) ?? name,
        kind: object.userData.kind,
        x: vector.x, z: vector.z, y: vector.y, yaw: Math.atan2(-heading.x, -heading.z),
      });
    }
    if (typeof object.userData.approach_degrees === "number") authoredSignals.push(object);
    if (solidBuilding.test(name)) solids.push(new THREE.Box3().setFromObject(object));
    if (!(object instanceof THREE.Mesh)) return;
    const floorName = /^(Beach slope|Harbour quay|Timber pier)/;
    const parentName = authoredName(object.parent);
    const floor = walkable.test(name) || walkable.test(parentName) || floorName.test(name) || floorName.test(parentName);
    const cameraObstacle = /^(Bus shelter|Canopy|.* rail platform and stairs)/;
    if (solidBuilding.test(name) || solidBuilding.test(parentName) || cameraObstacle.test(name) || cameraObstacle.test(parentName)) {
      cameraObstacles.push(object);
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (floor && materials.every(({ name }) => !/^(Sea|Coastal shallows|Foam|Ivory|Ink|Bark)$/.test(name))) ground.push(object);
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (!decorated.has(material)) {
        fitCityMaterial(material, surfaceTextures);
        if (material.name === "Sea" || material.name === "Coastal shallows") addSeaWaves(material, seaClock, sky);
        decorated.add(material);
      }
      if (/Warm windows|Glazing|Reflective glass/.test(material.name)) {
        material.emissive.set(material.name === "Warm windows" ? 0xffbe67 : 0xe1ac67);
        nightMaterials.add(material);
      }
      if (material.name === "Foam") foamMaterials.add(material);
      if (material.name === "Asphalt") asphalt.add(material);
      if (/^(Leaf green|Olive foliage|Pine green)$/.test(material.name)) foliage.add(material);
    }
  });
  const spawn = places.find(({ kind }) => kind === "vehicle_spawn");
  if (!spawn || !train) {
    [bus, ...cars].forEach((model) => model.dispose());
    disposeCity(map);
    signalGeometry.dispose();
    signalOff.dispose();
    domeGeometry.dispose();
    domeMaterial.dispose();
    Object.values(signalMaterials).forEach((material) => material.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    throw new Error("City map is missing its spawn point or train");
  }
  const trees = createCityTrees(scene, map, streetTree);
  const roadTexture = new THREE.TextureLoader().load("/surfaces/asphalt-color.webp", (texture) => {
    if (signal.aborted) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    for (const material of asphalt) {
      material.map = texture;
      material.color.set(0x9fa5ae);
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <uv_vertex>",
          "#include <uv_vertex>\nvMapUv = (modelMatrix * vec4(position, 1.0)).xz * 0.42;",
        );
      };
      material.needsUpdate = true;
    }
  });
  for (const material of foliage) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.cityWind = wind;
      shader.vertexShader = "uniform float cityWind;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\ntransformed.x += sin(cityWind + position.y * 1.8 + position.z) * 0.035;",
      );
    };
  }
  for (const pole of authoredSignals) {
    const axis = pole.userData.approach_degrees % 180 === 0 ? "z" : "x";
    const [x, y] = String(pole.userData.junction).split(",").map(Number);
    const offset = Math.max(0, junctions.findIndex((junction) => junction.x === x && junction.z === -y)) * 4;
    ["green", "amber", "red"].forEach((color, index) => {
      const mesh = new THREE.Mesh(signalGeometry, signalOff);
      mesh.position.set(0, 3.05 + index * 0.4, 0.39);
      pole.add(mesh);
      bulbs.push({ mesh, axis, offset, color });
    });
  }

  const light = new THREE.HemisphereLight(0xe6f4ff, 0x8a7769, 2.2);
  const sun = new THREE.DirectionalLight(0xffdfae, 2.9);
  sun.shadow.mapSize.set(512, 512);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 75 });
  sun.shadow.bias = -0.00045;
  sun.shadow.normalBias = 0.025;
  scene.add(light, sun, sun.target);
  map.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.receiveShadow = ground.includes(object);
    object.castShadow = solidBuilding.test(authoredName(object)) || solidBuilding.test(authoredName(object.parent));
  });
  for (const { root } of cars) root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const reflections = pmrem.fromScene(environment, 0.06);
  scene.environment = reflections.texture;
  scene.environmentIntensity = 0.32;
  environment.dispose();
  pmrem.dispose();
  const shadowSize = 24;
  const shadowPixels = new Uint8Array(shadowSize * shadowSize * 4);
  for (let row = 0; row < shadowSize; row++) {
    for (let column = 0; column < shadowSize; column++) {
      const radius = Math.hypot(column / (shadowSize - 1) * 2 - 1, row / (shadowSize - 1) * 2 - 1);
      shadowPixels[(row * shadowSize + column) * 4 + 3] = Math.round(128 * Math.max(0, 1 - radius ** 2) ** 2);
    }
  }
  const contactTexture = new THREE.DataTexture(shadowPixels, shadowSize, shadowSize);
  contactTexture.minFilter = contactTexture.magFilter = THREE.LinearFilter;
  contactTexture.needsUpdate = true;
  const contactGeometry = new THREE.PlaneGeometry(1, 1);
  const contactMaterial = new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const contacts = new Map<THREE.Object3D, THREE.Mesh>();
  function addContact(root: THREE.Object3D, isBus = false) {
    const mesh = new THREE.Mesh(contactGeometry, contactMaterial);
    mesh.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
    mesh.scale.set(isBus ? 3.6 : 2.8, isBus ? 9.5 : 5.3, 1);
    contacts.set(root, mesh);
    scene.add(mesh);
  }
  addContact(bus.root, true);
  for (const { root } of cars) addContact(root);

  const rainGeometry = new THREE.BufferGeometry();
  const drops = new Float32Array(450 * 6);
  const rainAttribute = new THREE.BufferAttribute(drops, 3).setUsage(THREE.DynamicDrawUsage);
  rainGeometry.setAttribute("position", rainAttribute);
  const rainMaterial = new THREE.LineBasicMaterial({ color: 0xc7e3eb, transparent: true, opacity: 0.36, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);
  const splashGeometry = new THREE.RingGeometry(0.35, 0.43, 26);
  const splashMaterial = new THREE.MeshBasicMaterial({ color: 0xbcf3e8, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
  const splash = new THREE.Mesh(splashGeometry, splashMaterial);
  splash.rotation.x = -Math.PI / 2;
  splash.visible = false;
  scene.add(splash);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const view = new THREE.PerspectiveCamera(61, 1, 0.08, 145);
  const cabin = createCabinCameras(renderer, scene);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const focus = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const chasePosition = new THREE.Vector3();
  const cameraRay = new THREE.Raycaster();
  const cameraHits: THREE.Intersection[] = [];
  let previousMode: CameraMode | undefined;
  let aspect = 1;
  let currentGraphics: CityGraphics | undefined;
  let frameCount = 0;
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = host;
    if (width === 0 || height === 0) return;
    aspect = width / height;
    view.aspect = aspect;
    view.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const ray = new THREE.Raycaster();
  ray.ray.direction.set(0, -1, 0);
  const hits: THREE.Intersection[] = [];
  function height(x: number, z: number, from = 45) {
    if (isDeepWater(x, z)) return -1.21;
    ray.ray.origin.set(x, from, z);
    hits.length = 0;
    ray.intersectObjects(ground, false, hits);
    return hits[0]?.point.y ?? -0.16;
  }
  function blocked(x: number, z: number, y = 0) {
    return !insideCity(x, z) || solids.some((box) => x > box.min.x && x < box.max.x
      && z > box.min.z && z < box.max.z && y < box.max.y);
  }

  const chunks: { chunk: THREE.Object3D; bounds: THREE.Box3 }[] = [];
  map.traverse((object) => {
    if (authoredName(object) === "Downtown blocks") {
      for (const chunk of object.children) chunks.push({ chunk, bounds: new THREE.Box3().setFromObject(chunk) });
    }
  });
  return {
    scene, places, spawn, train, cars, bus, people, traffic, height, blocked, reduced,
    async addCar(vehicle: VehicleSelection, pose: Pose) {
      const car = await createCityCar({ ...vehicle }, pose, renderer);
      if (signal.aborted) {
        car.dispose();
        throw new DOMException("City loading cancelled", "AbortError");
      }
      cars.push(car);
      scene.add(car.root);
      addContact(car.root);
      return car;
    },
    removeCar(car: (typeof cars)[number]) {
      const index = cars.indexOf(car);
      if (index === -1) return;
      cars.splice(index, 1);
      contacts.get(car.root)?.removeFromParent();
      contacts.delete(car.root);
      car.root.removeFromParent();
      car.dispose();
    },
    render(pose: Pose, y: number, mode: CameraMode, playerHeight: number, graphics: CityGraphics, hour: number,
      time: number, dt: number, rainy: boolean, swimming: boolean, ridingTrain: boolean,
      transfer?: Pose & { side: number; blend: number }) {
      if (currentGraphics !== graphics) {
        const { distance, pixels, shadow } = cityGraphics[graphics];
        currentGraphics = graphics;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, pixels));
        renderer.shadowMap.enabled = shadow;
        sun.castShadow = shadow;
        fog.near = distance * 0.54;
        fog.far = distance;
        view.far = distance;
        resize();
      }
      const daylight = THREE.MathUtils.smoothstep(Math.sin((hour - 6) / 24 * Math.PI * 2), -0.19, 0.62);
      const twilight = 1 - Math.abs(daylight * 2 - 1);
      sky.copy(nightSky).lerp(daySky, daylight).lerp(duskSky, twilight * 0.46);
      if (rainy) sky.multiplyScalar(0.8);
      zenith.copy(nightSky).multiplyScalar(0.53).lerp(rainy ? sky : blueSky, daylight);
      wind.value = reduced.matches ? 0 : time * 1.8;
      seaClock.value = reduced.matches ? 0 : time;
      fog.color.copy(sky);
      light.intensity = 0.72 + 1.45 * daylight;
      sun.intensity = 0.17 + daylight * (rainy ? 0.9 : 2.35);
      sun.color.copy(nightColor).lerp(sunColor, daylight);
      sun.position.set(pose.x - 25, y + 32, pose.z - 20);
      sun.target.position.set(pose.x, y, pose.z);
      for (const material of nightMaterials) material.emissiveIntensity = (1 - daylight) * 0.66;
      for (const material of foamMaterials) material.color.setScalar(0.64 + Math.sin(time * 2.1) * 0.14);
      for (const { mesh, axis, offset, color } of bulbs) {
        mesh.material = trafficSignal(time, axis, offset) === color ? signalMaterials[color] : signalOff;
      }
      splash.visible = swimming;
      for (const [root, mesh] of contacts) {
        mesh.visible = root.position.y > -0.88;
        mesh.position.copy(root.position);
        mesh.position.y += 0.016;
        mesh.rotation.y = root.rotation.y;
      }
      if (swimming) {
        splash.position.set(pose.x, -1.17, pose.z);
        splash.scale.setScalar(1.2 + ((time * 2.7) % 1) * 1.8);
        splashMaterial.opacity = 0.5 * (1 - (time * 2.7) % 1);
      }
      rain.visible = rainy && !reduced.matches;
      if (rain.visible) {
        for (let i = 0; i < drops.length; i += 6) {
          const x = pose.x + ((i * 0.737 + time * 2) % 32) - 16;
          const z = pose.z + (i * 1.137 % 32) - 16;
          const drop = y + 15 - (i * 0.391 + time * 19) % 15;
          drops[i] = x;
          drops[i + 1] = drop;
          drops[i + 2] = z;
          drops[i + 3] = x - 0.12;
          drops[i + 4] = drop - 0.85;
          drops[i + 5] = z;
        }
        rainAttribute.needsUpdate = true;
      }
      if (frameCount++ % 15 === 0) {
        trees.update(pose, cityGraphics[graphics].trees);
        for (const { chunk, bounds } of chunks) {
          vector.set(pose.x, y, pose.z);
          chunk.visible = bounds.distanceToPoint(vector) < cityGraphics[graphics].distance;
        }
      }

      if (mode === "Cabin" || mode === "Rear") {
        const camera = mode === "Cabin" ? cabin.cabinView(pose, aspect, playerHeight) : cabin.rearView(pose, aspect);
        if (mode === "Rear") camera.position.y += y;
        dome.position.copy(camera.position);
        renderer.render(scene, camera);
        previousMode = mode;
        return;
      }
      const sn = Math.sin(pose.yaw);
      const cs = Math.cos(pose.yaw);
      aim.set(pose.x - sn * 3, y + 0.65, pose.z - cs * 3);
      if (mode === "Overhead") desired.set(pose.x, y + 24, pose.z + 0.06);
      else if (ridingTrain) desired.set(pose.x + 14, y + 7, pose.z + cs * 11);
      else {
        const distance = playerHeight > 2 ? 11.7 : 8.4;
        desired.set(pose.x + sn * distance, y + 4.1 + playerHeight * 0.33, pose.z + cs * distance);
      }
      if (transfer) {
        const flank = Math.cos(transfer.yaw) * transfer.side;
        const sideZ = -Math.sin(transfer.yaw) * transfer.side;
        desired.lerp(vector.set(transfer.x + flank * 4.9 + Math.sin(transfer.yaw) * 2.5, y + 2.6,
          transfer.z + sideZ * 4.9 + Math.cos(transfer.yaw) * 2.5), transfer.blend);
        aim.lerp(vector.set(transfer.x + flank * 0.5, y + 0.9, transfer.z + sideZ * 0.5), transfer.blend);
      }
      const alpha = previousMode && !reduced.matches && focus.distanceToSquared(aim) < 400 ? 1 - Math.exp(-9 * dt) : 1;
      focus.lerp(aim, alpha);
      chasePosition.lerp(desired, alpha);
      view.position.copy(chasePosition);
      if (mode !== "Overhead") {
        cameraRay.ray.origin.set(pose.x, y + 1.15, pose.z);
        cameraRay.ray.direction.subVectors(chasePosition, cameraRay.ray.origin);
        cameraRay.far = cameraRay.ray.direction.length();
        cameraRay.ray.direction.normalize();
        cameraHits.length = 0;
        cameraRay.intersectObjects(cameraObstacles, false, cameraHits);
        if (cameraHits.length) {
          cameraRay.ray.at(Math.max(0.25, cameraHits[0].distance - 0.28), view.position);
        }
      }
      view.lookAt(focus);
      dome.position.copy(view.position);
      previousMode = mode;
      renderer.render(scene, view);
    },
    dispose() {
      observer.disconnect();
      cabin.dispose();
      reflections.dispose();
      roadTexture.dispose();
      contactTexture.dispose();
      trees.dispose();
      disposeCity(map);
      for (const model of [bus, ...cars]) model.dispose();
      for (const geometry of [rainGeometry, splashGeometry, signalGeometry, domeGeometry, contactGeometry]) geometry.dispose();
      for (const material of [rainMaterial, splashMaterial, signalOff, domeMaterial, contactMaterial, ...Object.values(signalMaterials)]) material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
