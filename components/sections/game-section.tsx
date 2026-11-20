import type { Level } from "@/types/game";
import { ParkingGame } from "@/components/sections/parking-game";

export function GameSection({ levels }: { levels: Level[] }) {
  return (
    <main className="game-shell">
      <ParkingGame levels={levels} />
    </main>
  );
}
