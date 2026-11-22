"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { InstallPrompt, type ApkInfo } from "@/components/ui/install-prompt";

/** Bridges the web game and the Android app: hides the native splash in the app, offers the APK in mobile browsers. */
export function NativeShell({ apk }: { apk: ApkInfo | null }) {
  const [native, setNative] = useState<boolean | null>(null);

  useEffect(() => {
    const isNative = Capacitor.isNativePlatform();
    setNative(isNative);
    if (!isNative) return;
    document.documentElement.dataset.native = Capacitor.getPlatform();
    void SplashScreen.hide();
    if (Capacitor.getPlatform() === "android") {
      void import("@/lib/utils/android-live-update").then(({ stageAndroidUpdate }) => stageAndroidUpdate())
        .catch((error: unknown) => console.warn("Parkline live update could not be checked", error));
    }
  }, []);

  if (native !== false || !apk) return null;
  return <InstallPrompt apk={apk} />;
}
