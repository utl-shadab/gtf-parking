export const vehicleIds = [
  "thar", "gt", "hatch", "sedan", "suv", "audi", "ferrari",
  "fortuner", "defender", "gtr", "porsche", "mustang", "roxx",
  "bolero", "bugatti", "endeavour", "legender", "lamborghini-v1", "lamborghini-2022",
  "g-class", "monster-fortuner", "monster-koenigsegg", "monster-lamborghini-v1",
  "monster-lamborghini-2022", "monster-police", "monster-police-4", "monster-thar",
  "monster-tarzen", "police", "police-4", "rolls-royce", "scorpio", "tarzen",
  "thar-modified", "thar-normal", "koenigsegg", "supra", "hummer",
] as const;
export type VehicleId = typeof vehicleIds[number];

export interface VehicleSelection {
  id: VehicleId;
  color: string;
  roof: boolean;
}

export interface GarageState {
  active: VehicleId;
  cars: Record<VehicleId, VehicleSelection>;
}
