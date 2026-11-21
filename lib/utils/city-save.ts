import type { Pose } from "@/types/game";
import { vehicleIds, type VehicleId, type VehicleSelection } from "@/types/vehicle";
import { insideCity } from "./city-rules";

const key = "parkline-city-v1";

export interface CitySave {
  pose: Pose | null;
  parkedAt?: Pose;
  vehicle: VehicleSelection;
  hour: number;
  violations: number;
}

function readPose(pose: Pose | null | undefined) {
  return pose && Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.yaw)
    && insideCity(pose.x, pose.z) ? pose : null;
}

export function readCitySave(fallback: VehicleSelection): CitySave {
  const defaults = { pose: null, vehicle: fallback, hour: 16.6, violations: 0 };
  try {
    const save: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!save || typeof save !== "object") return defaults;
    const { pose, parkedAt, vehicle, hour, violations } = save as Partial<CitySave>;
    const validVehicle = vehicle && vehicleIds.includes(vehicle.id as VehicleId) && typeof vehicle.color === "string"
      && /^#[a-f0-9]{6}$/i.test(vehicle.color) && typeof vehicle.roof === "boolean";
    return {
      pose: readPose(pose),
      parkedAt: readPose(parkedAt) ?? undefined,
      vehicle: validVehicle ? vehicle : fallback,
      hour: typeof hour === "number" && hour >= 0 && hour < 24 ? hour : defaults.hour,
      violations: typeof violations === "number" && Number.isSafeInteger(violations) && violations >= 0 ? violations : 0,
    };
  } catch {
    return defaults;
  }
}

export function saveCity(save: CitySave) {
  try { localStorage.setItem(key, JSON.stringify(save)); } catch { /* Storage may be unavailable. */ }
}
