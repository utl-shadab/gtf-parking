import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { BAY_LINE_WIDTH, CAR_LENGTH, CAR_WIDTH, LOT_LENGTH, LOT_WIDTH, STALL_SPACING, obstacleSize, parkingRow } from "./driving";
import type { DriveState } from "./driving";
import type { CameraMode, Level, Obstacle, ParkingBay } from "@/types/game";
import type { VehicleSelection } from "@/types/vehicle";
import { createCabinCameras, rearDisplayLayer } from "./cabin-cameras";
import { vehicles } from "./garage";
import { findRoadLettering } from "./road-lettering";
import { buildPlayerVehicle, loadCarAsset, loadPlayerVehicle } from "./player-vehicle";

const files = {
  "parking-floor": "parking-floor", barrier: "barrier", wall: "wall",
  "street-hatch": "car/street-hatch",
  sedan: "car/street-sedan", suv: "car/street-suv",
  traffic: "car/traffic-pack",
  office: "streetscape/office", storefront: "streetscape/storefront",
  tree: "city/street-tree",
} as const;
type ModelName = keyof typeof files;
type Models = Map<ModelName, THREE.Group>;

let modelRequest: Promise<Models> | undefined;
type SurfaceMaps = [asphalt: THREE.Texture, normal: THREE.Texture, grass: THREE.Texture, stone: THREE.Texture];
let surfaceRequest: Promise<SurfaceMaps> | undefined;

function loadSurfaceMaps() {
  if (surfaceRequest) return surfaceRequest;
  const loader = new THREE.TextureLoader();
  surfaceRequest = Promise.all([
    loader.loadAsync("/surfaces/asphalt-color.webp"),
    loader.loadAsync("/surfaces/asphalt-normal.webp"),
    loader.loadAsync("/surfaces/grass.webp"),
    loader.loadAsync("/surfaces/stone.webp"),
  ]).then(([color, normal, grass, stone]): SurfaceMaps => {
    color.colorSpace = THREE.SRGBColorSpace;
    grass.colorSpace = THREE.SRGBColorSpace;
    stone.colorSpace = THREE.SRGBColorSpace;
    return [color, normal, grass, stone];
  }).catch((error: unknown) => {
    surfaceRequest = undefined;
    throw error;
  });
  return surfaceRequest;
}

function loadModels(renderer: THREE.WebGLRenderer) {
  if (modelRequest) return modelRequest;
  const textures = new KTX2Loader().setTranscoderPath("/basis/").setWorkerLimit(2).detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(textures).setMeshoptDecoder(MeshoptDecoder);
  modelRequest = Promise.all((Object.keys(files) as ModelName[]).map(async (name) => {
    const path = files[name];
    const asset = path.startsWith("car/") ? loadCarAsset(path.slice(4), renderer)
      : loader.loadAsync(`/models/${path}.glb`).then((gltf) => gltf.scene);
    const scene = await asset.catch((error: unknown) => {
      if (name === "traffic") return new THREE.Group();
      throw error;
    });
    return [name, scene] as const;
  })).then((entries) => new Map(entries)).catch((error: unknown) => {
    modelRequest = undefined;
    throw error;
  }).finally(() => textures.dispose());
  return modelRequest;
}

function fittedModel(models: Models, name: ModelName, width: number, height: number, length: number, variant?: string) {
  const source = (variant && models.get("traffic")?.getObjectByName(variant)) || models.get(name);
  if (!source) throw new Error(`Model missing: ${name}`);
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const normalized = new THREE.Group();
  model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  normalized.add(model);
  if (name === "barrier" || name === "wall") {
    normalized.rotation.y = Math.PI / 2;
    [size.x, size.z] = [size.z, size.x];
  }
  const modelBox = new THREE.Group();
  modelBox.add(normalized);
  modelBox.scale.set(width / size.x, height / size.y, length / size.z);
  return modelBox;
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a drawing context");
  draw(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export async function createParkingScene(host: HTMLDivElement, level: Level, selection: VehicleSelection, signal: AbortSignal) {
  const lotWidth = level.lot?.width ?? LOT_WIDTH;
  const lotLength = level.lot?.length ?? LOT_LENGTH;
  const streetOffset = (lotLength - LOT_LENGTH) / 2;
  signal.throwIfAborted();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  let models: Models;
  let surfaceMaps: SurfaceMaps;
  let playerSource: THREE.Object3D;

  try {
    [models, surfaceMaps, playerSource] = await Promise.all([
      loadModels(renderer), loadSurfaceMaps(), loadPlayerVehicle(selection.id, renderer), document.fonts.ready,
    ]);
    signal.throwIfAborted();
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#b6bcb7");
  const camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 0.1, 130);
  camera.layers.enable(rearDisplayLayer);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.19;
  const initialPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(initialPixelRatio);
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  geometries.add(cube);
  const material = (color: string) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.88 });
    materials.add(value);
    return value;
  };
  const block = (
    x: number, y: number, z: number, w: number, h: number, l: number,
    surface: THREE.Material, parent: THREE.Object3D = scene,
  ) => {
    const mesh = new THREE.Mesh(cube, surface);
    mesh.scale.set(w, h, l);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  scene.add(new THREE.HemisphereLight("#e3edff", "#746e58", 2.3));
  const sunlight = new THREE.DirectionalLight("#fff0d3", 2.5);
  sunlight.position.set(-8, 15, -5);
  scene.add(sunlight);

  const asphalt = material("#929392");
  function tiled(source: THREE.Texture | null, x: number, y: number) {
    if (!source) return null;
    const texture = source.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(x, y);
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.add(texture);
    return texture;
  }
  asphalt.map = tiled(surfaceMaps[0], 10 * lotWidth / LOT_WIDTH, 8 * lotLength / LOT_LENGTH);
  asphalt.normalMap = tiled(surfaceMaps[1], 10 * lotWidth / LOT_WIDTH, 8 * lotLength / LOT_LENGTH);
  asphalt.normalScale.setScalar(0.38);
  const asphaltTop = new THREE.PlaneGeometry(lotWidth, lotLength);
  geometries.add(asphaltTop);
  const asphaltSurface = new THREE.Mesh(asphaltTop, asphalt);
  asphaltSurface.rotation.x = -Math.PI / 2;
  asphaltSurface.position.y = 0.012;
  scene.add(asphaltSurface);

  const gameFont = getComputedStyle(host).getPropertyValue("--display").trim();
  const roadPaint = canvasTexture(1024, 224, (ctx) => {
    ctx.font = `400 174px ${gameFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e4e0d2";
    ctx.fillText("GTF Technologies", 512, 116, 976);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.43)";
    for (let i = 0; i < 2800; i++) {
      const x = (i * 73 + i * i * 17) % 1024;
      const y = (i * 71 + i * i * 11) % 223;
      ctx.fillRect(x, y, 1 + i % 4, 1 + i % 3);
    }
  });
  roadPaint.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const paintGeometry = new THREE.PlaneGeometry(1, 1);
  const paintMaterial = new THREE.MeshBasicMaterial({ map: roadPaint, transparent: true, depthWrite: false, opacity: 0.82 });
  for (const { x, z, width, length } of findRoadLettering(level)) {
    const roadName = new THREE.Mesh(paintGeometry, paintMaterial);
    roadName.rotation.x = -Math.PI / 2;
    roadName.position.set(x, 0.018, z);
    roadName.scale.set(width, length, 1);
    scene.add(roadName);
  }
  textures.add(roadPaint);
  geometries.add(paintGeometry);
  materials.add(paintMaterial);

  const foundation = fittedModel(models, "parking-floor", lotWidth, 0.16, lotLength);
  foundation.position.y = -0.16;
  scene.add(foundation);
  const grass = material("#b7bd99");
  grass.map = tiled(surfaceMaps[2], 1, 1);
  function turf(x: number, y: number, z: number, width: number, length: number) {
    const geometry = new THREE.PlaneGeometry(width, length);
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (x + (uv.getX(i) - 0.5) * width) / 2.75, (-z + (uv.getY(i) - 0.5) * length) / 2.75);
    }
    geometries.add(geometry);
    const lawn = new THREE.Mesh(geometry, grass);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(x, y, z);
    scene.add(lawn);
  }
  const path = material("#b8b1a0");
  models.get("wall")?.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
      path.map = tiled(object.material.map, 6, 1);
    }
  });
  const curb = material("#9f9c89");
  curb.map = tiled(surfaceMaps[3], 9, 1);
  const curbDark = material("#343431");
  const curbLight = material("#d1a846");
  const stripe = material("#e1ddd0");
  const target = material("#f5cc62");
  const aligned = material("#8be4ae");
  const halfWidth = lotWidth / 2;
  const halfLength = lotLength / 2;
  const terrainHeight = -0.18;
  turf(0, terrainHeight, 0, 110, 100);
  block(0, -0.07, 0, lotWidth + 3.3, 0.14, lotLength + 3.3, path);
  const curbStripeLength = 0.9;
  const acrossCount = Math.round(lotWidth / curbStripeLength);
  const alongCount = Math.round(lotLength / curbStripeLength);
  const curbMarkings = [curbLight, curbDark].map((paint) => new THREE.InstancedMesh(cube, paint, acrossCount + alongCount));
  const curbIndices = [0, 0];
  const transform = new THREE.Object3D();
  function markCurb(across: boolean, side: number) {
    const count = across ? acrossCount : alongCount;
    const span = across ? lotWidth : lotLength;
    const segment = span / count;
    for (let i = 0; i < count; i++) {
      const offset = -span / 2 + (i + 0.5) * segment;
      transform.position.set(across ? offset : side * (halfWidth + 0.055), 0.093, across ? side * (halfLength + 0.055) : offset);
      transform.scale.set(across ? segment : 0.15, 0.186, across ? 0.15 : segment);
      transform.updateMatrix();
      const shade = (i + Number(side < 0) + Number(across)) % 2;
      curbMarkings[shade].setMatrixAt(curbIndices[shade]++, transform.matrix);
    }
  }
  for (const side of [-1, 1]) {
    turf(side * (halfWidth + 0.72), 0.024, 0, 0.84, lotLength + 0.6);
    turf(0, 0.024, side * (halfLength + 0.72), lotWidth + 2.28, 0.84);
    block(side * (halfWidth + 0.18), 0.08, 0, 0.24, 0.20, lotLength, curb);
    block(0, 0.08, side * (halfLength + 0.18), lotWidth + 0.6, 0.20, 0.24, curb);
    markCurb(true, side);
    markCurb(false, side);
  }
  scene.add(...curbMarkings);

  const divider = fittedModel(models, "wall", 9.7, 0.38, 0.27);
  divider.position.set(-7.4, 0, -12.26 - streetOffset);
  scene.add(divider);
  const secondDivider = divider.clone();
  secondDivider.position.x = 7.4;
  scene.add(secondDivider);
  block(0, -0.10, -16.15 - streetOffset, lotWidth + 17, 0.24, 1.15, path);
  const street = material("#6e7274");
  street.map = tiled(surfaceMaps[0], 16, 2);
  const streetGeometry = new THREE.PlaneGeometry(lotWidth + 19, 4.05);
  geometries.add(streetGeometry);
  const streetSurface = new THREE.Mesh(streetGeometry, street);
  streetSurface.rotation.x = -Math.PI / 2;
  streetSurface.position.set(0, -0.11, -13.85 - streetOffset);
  scene.add(streetSurface);
  for (let x = -halfWidth - 6.5; x <= halfWidth + 6.5; x += 3.5) block(x, -0.098, -13.85 - streetOffset, 1.35, 0.015, 0.055, stripe);

  const masonry = material("#ada494");
  masonry.map = path.map;
  for (const side of [-1, 1]) {
    for (const x of [-14, -4.65, 4.7, 14.05]) {
      const storefront = fittedModel(models, "storefront", 9.3, 2.85, 1.65);
      storefront.position.set(x, 0, side * (17.25 + streetOffset));
      storefront.rotation.y = side === 1 ? Math.PI : 0;
      scene.add(storefront);
      const levels = fittedModel(models, "office", 9.3, 4.2, 0.32);
      levels.position.set(x, 2.85, side * (17.82 + streetOffset));
      levels.rotation.y = storefront.rotation.y;
      scene.add(levels);
      block(x, 3.53, side * (20.05 + streetOffset), 9.25, 7.06, 4.1, masonry);
    }
  }
  const bay = level.bay;
  const paintWidth = BAY_LINE_WIDTH;
  const { start: rowStart, count: stallCount } = parkingRow(lotWidth);
  const rowEnd = rowStart + stallCount * STALL_SPACING;
  for (const z of [-6.7, 6.9]) {
    const activeStall = z === bay.z ? Math.floor((bay.x - rowStart) / STALL_SPACING) : -2;
    for (let i = 0; i <= stallCount; i++) {
      if (i === activeStall || i === activeStall + 1) continue;
      block(rowStart + i * STALL_SPACING, 0.025, z, paintWidth, 0.014, 4.8, stripe);
    }
    const spans = activeStall < 0 ? [[rowStart, rowEnd]] : [
      [rowStart, bay.x - bay.width / 2], [bay.x + bay.width / 2, rowEnd],
    ];
    for (const [start, end] of spans) {
      if (end - start <= paintWidth) continue;
      block((start + end) / 2, 0.025, z + Math.sign(z) * 2.4, end - start, 0.014, paintWidth, stripe);
    }
  }
  for (let i = 0; i < 6; i++) block(i * 0.42 - halfWidth + 1.35, 0.02, 0, 0.24, 0.018, 2.7, stripe);

  const bayPad = new THREE.MeshBasicMaterial({ color: "#dfbc4d", transparent: true, opacity: 0.19, depthWrite: false });
  materials.add(bayPad);
  const labelPlane = new THREE.PlaneGeometry(1.65, 0.65);
  geometries.add(labelPlane);
  function markBay({ x, z, yaw, width, length, id }: ParkingBay) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    scene.add(group);
    const lines = [
      block(-width / 2, 0.033, 0, paintWidth, 0.014, length, stripe, group),
      block(width / 2, 0.033, 0, paintWidth, 0.014, length, stripe, group),
      block(0, 0.033, -length / 2, width + paintWidth, 0.014, paintWidth, stripe, group),
      block(0, 0.033, length / 2, width + paintWidth, 0.014, paintWidth, stripe, group),
    ];
    const pad = block(0, 0.027, 0, width, 0.009, length, bayPad, group);
    const texture = canvasTexture(256, 96, (ctx) => {
      ctx.fillStyle = "#f9dea3";
      ctx.font = `400 65px ${gameFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(id, 128, 50);
    });
    textures.add(texture);
    const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    materials.add(labelMaterial);
    const label = new THREE.Mesh(labelPlane, labelMaterial);
    label.rotation.x = -Math.PI / 2;
    label.rotateZ(-yaw);
    const labelEnd = Math.cos(yaw) < -0.5 ? -1 : 1;
    label.position.set(0, 0.041, Math.sign(z) * labelEnd * 1.28);
    group.add(label);
    return { group, lines, pad, label };
  }
  const parkingMarkers = [...(level.stops ?? []), bay].map(markBay);
  let markedStop = -1;
  const arrowTexture = canvasTexture(96, 108, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(36, 10);
    ctx.lineTo(60, 10);
    ctx.lineTo(60, 51);
    ctx.lineTo(84, 51);
    ctx.lineTo(48, 95);
    ctx.lineTo(12, 51);
    ctx.lineTo(36, 51);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#352a19";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = "#fff5d9";
    ctx.fill();
  });
  textures.add(arrowTexture);
  const arrowMat = new THREE.SpriteMaterial({ map: arrowTexture, color: "#ffd35c", depthTest: false, depthWrite: false });
  const arrow = new THREE.Sprite(arrowMat);
  arrow.scale.set(1.24, 1.39, 1);
  arrow.position.set(0, 2.52, 0.16);
  arrow.renderOrder = 5;
  materials.add(arrowMat);

  const impactTexture = canvasTexture(96, 96, (ctx) => {
    ctx.beginPath();
    ctx.arc(48, 48, 32, 0, Math.PI * 2);
    ctx.lineWidth = 13;
    ctx.strokeStyle = "#301a17";
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ff754e";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(48, 48, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff5d5";
    ctx.fill();
  });
  const impactMaterial = new THREE.SpriteMaterial({ map: impactTexture, depthTest: false, depthWrite: false, toneMapped: false });
  const impactMarker = new THREE.Sprite(impactMaterial);
  impactMarker.scale.set(0.78, 0.78, 1);
  impactMarker.renderOrder = 6;
  impactMarker.visible = false;
  scene.add(impactMarker);
  textures.add(impactTexture);
  materials.add(impactMaterial);

  const hazardMap = canvasTexture(160, 40, (ctx) => {
    ctx.fillStyle = "#262720";
    ctx.fillRect(0, 0, 160, 40);
    ctx.fillStyle = "#e7b841";
    for (let x = -40; x <= 160; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, 40);
      ctx.lineTo(x + 13, 40);
      ctx.lineTo(x + 38, 0);
      ctx.lineTo(x + 25, 0);
      ctx.closePath();
      ctx.fill();
    }
  });
  textures.add(hazardMap);
  const hazard = material("#f3efe1");
  hazard.map = hazardMap;
  const dividerFinish = material("#a4a9ab");

  const shadowTexture = canvasTexture(64, 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, "rgba(0,0,0,0.72)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.44)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  });
  textures.add(shadowTexture);
  const shadow = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
  materials.add(shadow);
  const shadowPlane = new THREE.PlaneGeometry(1, 1);
  geometries.add(shadowPlane);

  const streetTree = fittedModel(models, "tree", 1.95, 3.15, 2.55);
  const plantings = [
    { z: -7.2, yaw: 0.7, scale: 0.94 },
    { z: 0, yaw: 2.4, scale: 1.04 },
    { z: 7.2, yaw: 4.1, scale: 0.98 },
  ];
  for (const side of [-1, 1]) {
    for (const { z, yaw, scale } of plantings) {
      const x = side * (halfWidth + 2.45);
      const tree = streetTree.clone();
      tree.position.set(x, terrainHeight, z);
      tree.rotation.y = side * yaw;
      tree.scale.multiplyScalar(scale);
      const shade = new THREE.Mesh(shadowPlane, shadow);
      shade.scale.set(3.1, 2.65, 1);
      shade.rotation.x = -Math.PI / 2;
      shade.position.set(x + 0.36, terrainHeight + 0.015, z + 0.22);
      scene.add(tree, shade);
    }
  }

  const modelNames: Record<NonNullable<Obstacle["style"]>, ModelName> = {
    hatch: "street-hatch", sedan: "sedan", utility: "suv",
  };
  const packedModels = {
    hatch: ["porsche", "ferrari"],
    sedan: ["audi", "gtr", "mustang"],
    utility: ["fortuner", "defender", "roxx"],
  } as const;
  const packHeights: Record<string, number> = { porsche: 1.04, ferrari: 1.03, audi: 1.15, gtr: 1.15, mustang: 1.18 };
  function addVehicle(group: THREE.Group, width: number, length: number) {
    const underbody = new THREE.Mesh(shadowPlane, shadow);
    underbody.scale.set(width * 1.78, length * 1.36, 1);
    underbody.rotation.x = -Math.PI / 2;
    underbody.position.set(0.18, 0.055, 0.22);
    group.add(underbody);
    scene.add(group);
    return group;
  }
  const makeVehicle = (name: ModelName, width: number, length: number, height: number, paint: string, packedModel?: string) => {
    const group = new THREE.Group();
    const car = fittedModel(models, name, width, height, length, packedModel);
    car.rotation.y = Math.PI;
    const variants = new Map<THREE.Material, THREE.Material>();
    car.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      const original = object.material;
      const previous = variants.get(original);
      if (previous) { object.material = previous; return; }
      const isPaint = !packedModel && /^paint(?:_|$)/i.test(original.name);
      const isGlass = original instanceof THREE.MeshPhysicalMaterial && original.transmission > 0;
      if (!isPaint && !isGlass) return;
      const variant = original.clone();
      if (isPaint) {
        variant.color.set(paint);
        variant.metalness = 0.22;
      }
      if (isGlass && variant instanceof THREE.MeshPhysicalMaterial) {
        variant.transmission = 0;
        variant.opacity = 1;
        variant.transparent = false;
        if (/glass/i.test(variant.name)) variant.color.set("#253035");
      }
      materials.add(variant);
      variants.set(original, variant);
      object.material = variant;
    });
    group.add(car);
    return addVehicle(group, width, length);
  };
  let trafficIndex = 0;
  const styleCounts = { hatch: 0, sedan: 0, utility: 0 };
  level.obstacles.forEach((obstacle) => {
    const { width, length } = obstacleSize(obstacle);
    let prop: THREE.Group;
    if (obstacle.kind === "barrier") {
      prop = new THREE.Group();
      const divider = fittedModel(models, "barrier", width, 0.66, length);
      divider.traverse((object) => {
        if (object instanceof THREE.Mesh) object.material = dividerFinish;
      });
      prop.add(divider);
      block(0, 0.64, 0, width * 0.86, 0.1, length * 0.96, dividerFinish, prop);
      for (const side of [-1, 1]) {
        block(side * width * 0.49, 0.18, 0, 0.018, 0.19, length * 0.94, hazard, prop);
        block(0, 0.18, side * length * 0.49, width * 0.94, 0.19, 0.018, hazard, prop);
      }
      scene.add(prop);
    } else {
      const style = obstacle.style ?? "hatch";
      const variants = packedModels[style];
      const choice = variants[styleCounts[style]++ % variants.length];
      const variant = trafficIndex++ % 3 !== 0 && models.get("traffic")?.getObjectByName(choice) ? choice : undefined;
      const height = variant ? packHeights[variant] ?? 1.5 : style === "utility" ? 1.47 : 1.19;
      prop = makeVehicle(modelNames[style], width, length, height, obstacle.color ?? "#546274", variant);
    }
    prop.position.set(obstacle.x, 0, obstacle.z);
    prop.rotation.y = obstacle.yaw;
  });
  const skyReflections = canvasTexture(128, 64, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "#7a91aa");
    gradient.addColorStop(0.44, "#c3cacf");
    gradient.addColorStop(0.54, "#777e70");
    gradient.addColorStop(1, "#3c423b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 64);
  });
  skyReflections.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const playerReflections = pmrem.fromEquirectangular(skyReflections);
  pmrem.dispose();
  skyReflections.dispose();
  const playerModel = buildPlayerVehicle(playerSource, selection.id, playerReflections.texture);
  playerModel.customize(selection);
  const player = addVehicle(new THREE.Group(), playerModel.size.x, playerModel.size.z);
  player.add(playerModel.root);
  const wheelSuffix = vehicles[selection.id].asset.startsWith("traffic-pack") ? `_${selection.id}` : "";
  const wheels = ["FL", "FR", "RL", "RR"].map((corner) => {
    const pivot = player.getObjectByName(`wheel_${corner}${wheelSuffix}`);
    return {
      pivot, rest: pivot?.quaternion.clone(),
      mesh: player.getObjectByName(`wheel_${corner}_mesh${wheelSuffix}`),
      front: corner.startsWith("F"),
    };
  });
  const wheelRadius = wheels[0].pivot?.getWorldPosition(new THREE.Vector3()).y || 0.31;
  const wheelYaw = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const cabin = createCabinCameras(renderer, scene);
  const frameFinish = material("#2f3832");
  const rearScreen = new THREE.MeshBasicMaterial({ map: cabin.picture });
  const rearScreenGeometry = new THREE.PlaneGeometry(7, 7 * 280 / 640);
  const signGeometry = new THREE.PlaneGeometry(7, 0.5);
  const signTexture = canvasTexture(768, 64, (ctx) => {
    ctx.fillStyle = "#253029";
    ctx.fillRect(0, 0, 768, 64);
    ctx.fillStyle = "#ffd584";
    ctx.beginPath();
    ctx.arc(31, 32, 7, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = `400 37px ${gameFont}`;
    ctx.textBaseline = "middle";
    ctx.fillText("REAR VIEW", 54, 33);
  });
  const signFinish = new THREE.MeshBasicMaterial({ map: signTexture, toneMapped: false });
  geometries.add(rearScreenGeometry);
  geometries.add(signGeometry);
  materials.add(rearScreen);
  materials.add(signFinish);
  textures.add(signTexture);
  const boardOffset = halfLength + 1.42;
  const displays = [-1, 1].map((side) => {
    const board = new THREE.Group();
    board.position.set(0, terrainHeight, side * boardOffset);
    board.rotation.y = side < 0 ? 0 : Math.PI;
    block(0, 2.87, 0, 7.28, 3.84, 0.24, frameFinish, board);
    for (const x of [-2.28, 2.28]) block(x, 0.7, -0.02, 0.17, 1.7, 0.24, frameFinish, board);
    const display = new THREE.Mesh(rearScreenGeometry, rearScreen);
    display.position.set(0, 2.64, 0.13);
    const sign = new THREE.Mesh(signGeometry, signFinish);
    sign.position.set(0, 4.43, 0.13);
    board.add(display, sign);
    // Keep the signs out of their own rear-camera feed.
    board.traverse((object) => object.layers.set(rearDisplayLayer));
    scene.add(board);
    board.updateMatrixWorld();
    return { side, board, display };
  });
  const frustum = new THREE.Frustum();
  const projection = new THREE.Matrix4();

  function updateRearDisplays(state: DriveState, view: THREE.Camera) {
    view.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse));
    for (const { side, board } of displays) board.visible = side * view.position.z < boardOffset;
    if (!state.impactAt && displays.some(({ board, display }) => board.visible && frustum.intersectsObject(display))) {
      cabin.captureRear(state);
    }
  }

  let aspect = 1;
  let initialized = false;
  let distance = 0;
  let slowFrames = 0;
  let previousState: DriveState | undefined;
  let previousMode: CameraMode = "Overview";
  let width = 0;
  let height = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const focus = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const resize = () => {
    const { clientWidth, clientHeight } = host;
    if (!clientWidth || !clientHeight || (clientWidth === width && clientHeight === height)) return;
    width = clientWidth;
    height = clientHeight;
    aspect = width / height;
    renderer.setSize(width, height, false);
    initialized = false;
    if (previousState) render(previousState, previousMode, 0);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function render(state: DriveState, mode: CameraMode, dt: number) {
    previousState = state;
    previousMode = mode;
    if (Math.abs(state.speed) > 0.1 && initialPixelRatio > 1) {
      slowFrames = dt > 0.043 ? slowFrames + 1 : Math.max(slowFrames - 1, 0);
      if (slowFrames === 12) renderer.setPixelRatio(1);
    }
    player.position.set(state.x, 0, state.z);
    player.rotation.y = state.yaw;
    distance = (distance + state.speed * dt / wheelRadius) % (Math.PI * 2);
    wheelYaw.setFromAxisAngle(up, -state.steering * 0.48);
    for (const { pivot, rest, mesh, front } of wheels) {
      if (pivot && rest && front) pivot.quaternion.copy(rest).premultiply(wheelYaw);
      if (mesh) mesh.rotation.x = distance;
    }
    const marker = parkingMarkers[state.stopIndex];
    if (state.stopIndex !== markedStop) {
      parkingMarkers.forEach(({ lines, pad, label }, index) => {
        const active = index === state.stopIndex;
        pad.visible = active;
        label.visible = active;
        if (!active) lines.forEach((line) => { line.material = index < state.stopIndex ? aligned : stripe; });
      });
      marker.group.add(arrow);
      markedStop = state.stopIndex;
    }
    marker.lines.forEach((line) => { line.material = state.aligned ? aligned : target; });
    bayPad.color.set(state.aligned ? "#83da9c" : "#dfbc4d");
    arrowMat.color.set(state.aligned ? "#a7ef9e" : "#ffd35c");
    const impact = state.impactAt;
    arrow.visible = !impact;
    impactMarker.visible = Boolean(impact);
    if (!impact && (mode === "Cabin" || mode === "Rear")) {
      const view = mode === "Cabin"
        ? cabin.cabinView(state, aspect, vehicles[selection.id].driverHeight ?? playerModel.size.y * 0.86)
        : cabin.rearView(state, aspect);
      if (mode === "Cabin") updateRearDisplays(state, view);
      renderer.render(scene, view);
      return;
    }
    let span: number;
    if (impact) {
      impactMarker.position.set(impact.x, state.impact === "wall" ? 0.12 : state.impact === "barrier" ? 0.22 : 0.42, impact.z);
      aim.set(state.x * 0.36 + impact.x * 0.64, 0.35, state.z * 0.36 + impact.z * 0.64);
      const angle = Math.atan2(impact.z - state.z, impact.x - state.x) + 0.96;
      desired.set(aim.x + Math.cos(angle) * 6.3, 10.5, aim.z + Math.sin(angle) * 6.3);
      span = Math.max(6.4, 7.6 / aspect);
    } else if (mode === "Chase") {
      aim.set(state.x - Math.sin(state.yaw) * 2.4, 0, state.z - Math.cos(state.yaw) * 2.4);
      desired.set(state.x + Math.sin(state.yaw) * 9.5, 7.9, state.z + Math.cos(state.yaw) * 9.5);
      span = Math.max(7.7, 10 / aspect);
    } else {
      aim.set(0, 0, 0);
      if (mode === "Overhead") desired.set(0, 31, 0.18);
      else desired.set(8.4, 28, 22);
      const groundDistance = Math.hypot(desired.x, desired.z);
      const side = Math.abs(desired.x) / groundDistance;
      const forward = Math.abs(desired.z) / groundDistance;
      const elevation = desired.y / desired.length();
      const width = lotWidth * forward + lotLength * side;
      const height = (lotWidth * side + lotLength * forward) * elevation;
      span = Math.max(height + 3.2, (width + 3.2) / aspect);
    }
    const alpha = initialized && !reducedMotion.matches ? 1 - Math.exp(-8 * dt) : 1;
    focus.lerp(aim, alpha);
    cameraPosition.lerp(desired, alpha);
    camera.position.copy(cameraPosition);
    camera.lookAt(focus);
    camera.top += (span / 2 - camera.top) * alpha;
    camera.bottom = -camera.top;
    camera.right = camera.top * aspect;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    initialized = true;
    updateRearDisplays(state, camera);
    renderer.render(scene, camera);
  }

  return {
    render,
    dispose() {
      observer.disconnect();
      cabin.dispose();
      playerModel.dispose();
      playerReflections.dispose();
      curbMarkings.forEach((marking) => marking.dispose());
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      textures.forEach((item) => item.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
