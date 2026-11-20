"use client";

import { GameError } from "@/components/ui/game-error";
import "./styles.css";

export default function GlobalError({ reset }: { reset: () => void }) {
  return <html lang="en"><body><GameError reset={reset} /></body></html>;
}
