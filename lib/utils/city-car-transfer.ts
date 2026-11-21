import type { Pose } from "../../types/game.ts";

export interface TransferPose extends Pose {
  y: number;
}

export interface CarTransfer {
  start: TransferPose;
  sill: TransferPose;
  seat: TransferPose;
  entering: boolean;
}

function ease(value: number, start: number, end: number) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function interpolate(from: TransferPose, to: TransferPose, t: number): TransferPose {
  const turn = to.yaw - from.yaw;
  const remaining = 1 - t;
  return {
    x: from.x * remaining + to.x * t,
    y: from.y * remaining + to.y * t,
    z: from.z * remaining + to.z * t,
    yaw: from.yaw + Math.atan2(Math.sin(turn), Math.cos(turn)) * t,
  };
}

export function sampleCarTransfer(transfer: CarTransfer, elapsed: number) {
  const progress = transfer.entering ? elapsed : 1 - elapsed;
  const seated = ease(progress, 0.41, 0.76);
  const stride = Math.sin(progress * 28) * (1 - ease(progress, 0.26, 0.50)) * 0.56;
  const reach = ease(progress, 0.08, 0.30) * (1 - ease(progress, 0.38, 0.67));
  const door = ease(progress, 0.14, 0.39) * (1 - ease(progress, 0.78, 1));
  const pose = progress < 0.41
    ? interpolate(transfer.start, transfer.sill, ease(progress, 0, 0.36))
    : interpolate(transfer.sill, transfer.seat, seated);
  if (!transfer.entering) pose.yaw += Math.PI * (1 - ease(progress, 0.07, 0.35));
  return { pose, seated, stride, reach, door };
}
