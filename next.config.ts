import type { NextConfig } from "next";

// `npm run android` sets BUILD_TARGET=android to emit a static `out/` folder that Capacitor bundles into the APK.
const android = process.env.BUILD_TARGET === "android";

const config: NextConfig = {
  devIndicators: false,
  agentRules: false,
  ...(android && { output: "export", images: { unoptimized: true } }),
};

export default config;
