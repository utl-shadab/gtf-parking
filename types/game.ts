export type Gear = "P" | "R" | "N" | "D";
export type CameraMode = "Overview" | "Chase" | "Overhead" | "Cabin" | "Rear";
export type Action = "left" | "right" | "pedal" | "brake";

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

export interface Obstacle extends Pose {
  kind: "car" | "barrier";
  color?: string;
  style?: "hatch" | "sedan" | "utility";
  campaignExtra?: true;
}

export interface ParkingBay extends Pose {
  width: number;
  length: number;
  id: string;
}

export interface Level {
  id: string;
  name: string;
  objective: string;
  start: Pose;
  bay: ParkingBay;
  stops?: ParkingBay[];
  obstacles: Obstacle[];
  lot?: { width: number; length: number };
}
