import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "node:fs";

const config: CapacitorConfig = {
  appId: "com.parkline.game",
  appName: "Parkline",
  webDir: "out",
  backgroundColor: "#191c19",
  android: {
    backgroundColor: "#191c19",
  },
  plugins: {
    LiveUpdate: {
      autoUpdateStrategy: "none",
      autoBlockRolledBackBundles: true,
      publicKey: readFileSync("public/android-update-key.pem", "utf8"),
      readyTimeout: 20000,
    },
    // Keep the native splash up until the game has painted (hidden from components/native/native-shell.tsx).
    SplashScreen: {
      launchAutoHide: false,
      launchFadeOutDuration: 240,
      backgroundColor: "#191c19",
      showSpinner: false,
    },
  },
};

export default config;
