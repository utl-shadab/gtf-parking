import { vehicleIds, type GarageState, type VehicleId, type VehicleSelection } from "../../types/vehicle.ts";

interface VehicleInfo {
  name: string;
  asset: string;
  color: string;
  paint?: string;
  roof?: boolean;
  driverHeight?: number;
}

export const vehicles: Record<VehicleId, VehicleInfo> = {
  thar: { name: "Thar", asset: "garage-thar", driverHeight: 1.34, color: "#244634", paint: "BodyPaint", roof: false },
  gt: { name: "GT Sports Coupé", asset: "garage-gt", driverHeight: 1.02, color: "#e7ad27", paint: "BodyPaint", roof: true },
  hatch: { name: "Street Hatchback", asset: "street-hatch", color: "#e9b94e", paint: "paint" },
  sedan: { name: "Family Sedan", asset: "street-sedan", color: "#254e6d", paint: "paint" },
  suv: { name: "Street SUV", asset: "street-suv", color: "#d7dbdc", paint: "paint_body" },
  audi: { name: "Audi", asset: "traffic-pack", color: "#c0c4cb", paint: "Body_D_1" },
  ferrari: { name: "Ferrari F8", asset: "traffic-pack", color: "#f2bd39", paint: "Body_Ferrari" },
  fortuner: { name: "Fortuner", asset: "traffic-pack", color: "#f4f4f1" },
  defender: { name: "Defender", asset: "traffic-pack", color: "#f4f4f1", paint: "Body_white" },
  gtr: { name: "Nissan GT-R", asset: "traffic-pack", color: "#ff9a00", paint: "Body_2" },
  porsche: { name: "Porsche", asset: "traffic-pack", color: "#f4f4f1", paint: "Body_D_46" },
  mustang: { name: "Mustang GT", asset: "traffic-pack", color: "#e3e3de", paint: "Body_Mustang" },
  roxx: { name: "Thar Roxx", asset: "traffic-pack", color: "#ff5959", paint: "Body" },
  bolero: { name: "Bolero", asset: "traffic-pack-2", color: "#a5a8a9" },
  bugatti: { name: "Bugatti", asset: "traffic-pack-2", color: "#405672" },
  endeavour: { name: "Ford Endeavour", asset: "traffic-pack-2", color: "#f4f4f1" },
  legender: { name: "Fortuner Legender", asset: "traffic-pack-2", color: "#f4f4f1" },
  "lamborghini-v1": { name: "Lamborghini V1", asset: "traffic-pack-2", color: "#6b4a9c" },
  "lamborghini-2022": { name: "Lamborghini 2022", asset: "traffic-pack-3", color: "#aeb3b6" },
  "g-class": { name: "Mercedes G-Class", asset: "traffic-pack-3", color: "#eae9e6" },
  "monster-fortuner": { name: "Monster Fortuner", asset: "traffic-pack-3", color: "#f4f4f1" },
  "monster-koenigsegg": { name: "Monster Koenigsegg", asset: "traffic-pack-3", color: "#c5c6c4" },
  "monster-lamborghini-v1": { name: "Monster Lamborghini V1", asset: "traffic-pack-3", color: "#6b4a9c" },
  "monster-lamborghini-2022": { name: "Monster Lamborghini 2022", asset: "traffic-pack-4", color: "#b6b9ba" },
  "monster-police": { name: "Monster Police Car", asset: "traffic-pack-4", color: "#2e3033" },
  "monster-police-4": { name: "Monster Police Car 4", asset: "traffic-pack-4", color: "#2e3033" },
  "monster-thar": { name: "Monster Thar", asset: "traffic-pack-4", color: "#e35850" },
  "monster-tarzen": { name: "Monster Tarzen", asset: "traffic-pack-4", color: "#804ab2" },
  police: { name: "Police Car", asset: "traffic-pack-5", color: "#181d1f" },
  "police-4": { name: "Police Car 4", asset: "traffic-pack-5", color: "#23272b" },
  "rolls-royce": { name: "Rolls-Royce", asset: "traffic-pack-5", color: "#b43337" },
  scorpio: { name: "Scorpio Classic", asset: "traffic-pack-5", color: "#b8b8b8" },
  tarzen: { name: "Tarzen", asset: "traffic-pack-5", color: "#5c3c96" },
  "thar-modified": { name: "Thar Modified", asset: "traffic-pack-6", color: "#cc4545" },
  "thar-normal": { name: "Thar Classic", asset: "traffic-pack-6", color: "#b1413a" },
  koenigsegg: { name: "Koenigsegg", asset: "traffic-pack-6", color: "#bc8b37" },
  supra: { name: "Toyota Supra", asset: "traffic-pack-6", color: "#c64741" },
  hummer: { name: "Hummer", asset: "traffic-pack-6", color: "#343a3e" },
};

function isVehicleId(value: unknown): value is VehicleId {
  return vehicleIds.some((id) => id === value);
}

export const garageKey = "parkline-garage-v1";
export const defaultGarage: GarageState = {
  active: "thar",
  cars: Object.fromEntries(vehicleIds.map((id) => [id, { id, color: vehicles[id].color, roof: vehicles[id].roof ?? true }])) as GarageState["cars"],
};

export function readGarage(raw: string | null): GarageState {
  if (!raw) return defaultGarage;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || !("cars" in data) || !data.cars || typeof data.cars !== "object") return defaultGarage;
    const cars = data.cars as Partial<Record<VehicleId, unknown>>;
    const restore = (id: VehicleId): VehicleSelection => {
      const value = cars[id];
      const fallback = defaultGarage.cars[id];
      if (!value || typeof value !== "object") return fallback;
      return {
        id,
        color: "color" in value && typeof value.color === "string" && /^#[\da-f]{6}$/i.test(value.color) ? value.color : fallback.color,
        roof: "roof" in value && typeof value.roof === "boolean" ? value.roof : fallback.roof,
      };
    };
    return {
      active: "active" in data && isVehicleId(data.active) ? data.active : "thar",
      cars: Object.fromEntries(vehicleIds.map((id) => [id, restore(id)])) as GarageState["cars"],
    };
  } catch {
    return defaultGarage;
  }
}
