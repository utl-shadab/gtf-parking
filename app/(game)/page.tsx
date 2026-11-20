import { Suspense } from "react";
import { GameSection } from "@/components/sections/game-section";
import { LoadingGame } from "@/components/ui/loading-game";
import { getLevels } from "@/lib/api/levels";

function ParkingGameData() {
  return <GameSection levels={getLevels()} />;
}

export default function Page() {
  return <Suspense fallback={<LoadingGame />}><ParkingGameData /></Suspense>;
}
