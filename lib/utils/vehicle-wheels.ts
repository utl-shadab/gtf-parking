import { Quaternion, Vector3, type Object3D } from "three";

export function createVehicleWheels(root: Object3D, suffix: string) {
  const position = new Vector3();
  const wheels = ["FL", "FR", "RL", "RR"].map((corner) => {
    const pivot = root.getObjectByName(`wheel_${corner}${suffix}`);
    const mesh = root.getObjectByName(`wheel_${corner}_mesh${suffix}`);
    return {
      pivot, mesh, rest: pivot?.quaternion.clone(), initialRoll: mesh?.rotation.x ?? 0,
      front: corner.startsWith("F"), radius: pivot?.getWorldPosition(position).y || 0.31, roll: 0,
    };
  });
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  return (distance: number, steering: number) => {
    turn.setFromAxisAngle(up, -steering * 0.48);
    for (const wheel of wheels) {
      const { pivot, mesh, rest, front, initialRoll, radius } = wheel;
      if (pivot && rest && front) pivot.quaternion.copy(rest).premultiply(turn);
      if (mesh) {
        wheel.roll = (wheel.roll + distance / radius) % (Math.PI * 2);
        mesh.rotation.x = initialRoll + wheel.roll;
      }
    }
  };
}
