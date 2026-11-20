import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import "./styles.css";

export const metadata: Metadata = {
  title: "Parkline — 3D Parking Trials",
  description: "A precision parking game with live 3D driving and touch controls.",
};

export const viewport: Viewport = { themeColor: "#191c19", viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  const localDemo = existsSync(join(process.cwd(), "public", "fonts", "game-paused-demo.otf"));
  return (
    <html lang="en">
      <head>{localDemo && <style>{`@font-face{font-family:"Game Paused DEMO";src:url("/fonts/game-paused-demo.otf") format("opentype");font-weight:400;font-display:swap;}`}</style>}</head>
      <body>{children}</body>
    </html>
  );
}
