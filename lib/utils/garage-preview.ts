import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { VehicleId, VehicleSelection } from "@/types/vehicle";
import { buildPlayerVehicle, loadPlayerVehicle } from "./player-vehicle";

export function createGaragePreview(host: HTMLDivElement) {
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 64;
  const context = shadowCanvas.getContext("2d");
  if (!context) throw new Error("Could not create the garage shadow.");
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  const room = new RoomEnvironment();
  const lightCard = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 1.5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.8, 1.7, 1.55), side: THREE.DoubleSide }),
  );
  lightCard.position.set(-1.4, 3.8, -1.3);
  lightCard.rotation.set(-1.15, 0.12, -0.22);
  room.add(lightCard);
  const fillCard = lightCard.clone();
  fillCard.position.set(2.8, 2.4, 1.4);
  fillCard.rotation.set(0, -1.1, 0.25);
  room.add(fillCard);
  const generator = new THREE.PMREMGenerator(renderer);
  const reflections = generator.fromScene(room, 0.055);
  scene.environment = reflections.texture;
  scene.environmentIntensity = 0.56;
  generator.dispose();
  room.dispose();
  scene.add(new THREE.HemisphereLight("#eef4ff", "#4a443b", 0.74));
  const key = new THREE.DirectionalLight("#ffeed9", 1.85);
  key.position.set(-3.5, 6, -4);
  key.castShadow = true;
  key.shadow.camera.left = key.shadow.camera.bottom = -3;
  key.shadow.camera.right = key.shadow.camera.top = 3;
  key.shadow.camera.far = 16;
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#c9def4", 0.77);
  rim.position.set(3, 3, 4.5);
  scene.add(rim);

  const shadowGradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
  shadowGradient.addColorStop(0, "#0204027a");
  shadowGradient.addColorStop(1, "#02040200");
  context.fillStyle = shadowGradient;
  context.fillRect(0, 0, 64, 64);
  const shadowMap = new THREE.CanvasTexture(shadowCanvas);
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false });
  const shadowGeometry = new THREE.PlaneGeometry(3.1, 5.4);
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.01;
  scene.add(shadow);
  const stageGeometry = new THREE.PlaneGeometry(10, 10);
  const stageMaterial = new THREE.ShadowMaterial({ color: "#0a0806", opacity: 0.34 });
  const stage = new THREE.Mesh(stageGeometry, stageMaterial);
  stage.rotation.x = -Math.PI / 2;
  stage.position.y = -0.006;
  stage.receiveShadow = true;
  scene.add(stage);

  let vehicle: ReturnType<typeof buildPlayerVehicle> | undefined;
  let visibleId: VehicleId | undefined;
  let selection: VehicleSelection | undefined;
  let yaw = -0.83;

  function render() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    const distance = Math.max(4.9, 5.1 / (width / height));
    camera.position.set(Math.sin(yaw) * distance, 1.59, -Math.cos(yaw) * distance);
    camera.aspect = width / height;
    camera.lookAt(0, 0.67, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  const observer = new ResizeObserver(() => {
    const { clientWidth, clientHeight } = host;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    render();
  });
  observer.observe(host);

  return {
    async select(id: VehicleId, signal: AbortSignal) {
      const source = await loadPlayerVehicle(id, renderer);
      signal.throwIfAborted();
      const next = buildPlayerVehicle(source, id);
      next.root.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) {
          object.castShadow = !object.material.transparent;
        }
      });
      if (vehicle) {
        scene.remove(vehicle.root);
        vehicle.dispose();
      }
      vehicle = next;
      visibleId = id;
      if (selection?.id === id) vehicle.customize(selection);
      scene.add(vehicle.root);
      render();
    },
    customize(next: VehicleSelection) {
      selection = next;
      if (visibleId === next.id) {
        vehicle?.customize(next);
        render();
      }
    },
    rotate(delta: number) {
      yaw += delta;
      render();
    },
    dispose() {
      observer.disconnect();
      vehicle?.dispose();
      shadowMap.dispose();
      shadowMaterial.dispose();
      shadowGeometry.dispose();
      stageGeometry.dispose();
      stageMaterial.dispose();
      key.shadow.dispose();
      reflections.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
