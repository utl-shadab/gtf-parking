import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.parkline.game",
  appName: "Parkline",
  webDir: "out",
  backgroundColor: "#191c19",
  android: {
    backgroundColor: "#191c19",
  },
  plugins: {
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
