import * as THREE from "three";
import type { Pose } from "@/types/game";

export const rearDisplayLayer = 1;
const displayAspect = 640 / 280;
const captureInterval = 1000 / 15;

export function createCabinCameras(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const cabin = new THREE.PerspectiveCamera(66, 1, 0.06, 100);
  cabin.layers.enable(rearDisplayLayer);
  const rear = new THREE.PerspectiveCamera(54, 1, 0.06, 90);
  const picture = new THREE.WebGLRenderTarget(640, 280, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  let capturedAt = -Infinity;
  let captured: (Pose & { stopIndex: number; aligned: boolean }) | undefined;

  function rearView({ x, z, yaw }: Pose, aspect: number) {
    const sn = Math.sin(yaw);
    const cs = Math.cos(yaw);
    // Mount the camera just past the bumper so the body's own mesh cannot hide the bay.
    rear.position.set(x + sn * 1.88, 1.23, z + cs * 1.88);
    rear.lookAt(x + sn * 6.8, 0.18, z + cs * 6.8);
    rear.aspect = aspect;
    rear.fov = Math.max(49, THREE.MathUtils.radToDeg(2 * Math.atan(0.55 / aspect)));
    rear.updateProjectionMatrix();
    return rear;
  }

  return {
    picture: picture.texture,
    rearView,
    cabinView({ x, z, yaw }: Pose, aspect: number, height: number) {
      const sn = Math.sin(yaw);
      const cs = Math.cos(yaw);
      cabin.position.set(x - sn * 0.53, height, z - cs * 0.53);
      cabin.lookAt(x - sn * 11, height - 0.37, z - cs * 11);
      cabin.aspect = aspect;
      cabin.updateProjectionMatrix();
      return cabin;
    },
    captureRear(state: Pose & { stopIndex: number; aligned: boolean }) {
      const now = performance.now();
      if (now - capturedAt < captureInterval) return;
      const { x, z, yaw, stopIndex, aligned } = state;
      if (captured?.x === x && captured.z === z && captured.yaw === yaw
        && captured.stopIndex === stopIndex && captured.aligned === aligned) return;
      const view = rearView(state, displayAspect);
      const previousTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(picture);
      renderer.render(scene, view);
      renderer.setRenderTarget(previousTarget);
      capturedAt = now;
      captured = { x, z, yaw, stopIndex, aligned };
    },
    dispose() {
      picture.dispose();
    },
  };
}
