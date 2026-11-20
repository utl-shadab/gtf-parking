// Builds the Android APK and publishes it for the website's install prompt.
//   node scripts/build-android.mjs            -> debug APK (installable, unsigned for the store)
//   node scripts/build-android.mjs --release  -> signed release APK (needs android/keystore.properties)
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const release = process.argv.includes("--release");
const run = (command, options = {}) => execSync(command, { stdio: "inherit", cwd: root, ...options });

console.log("\n> Static export for Android");
rmSync(join(root, "out"), { recursive: true, force: true });
run("npx next build", { env: { ...process.env, BUILD_TARGET: "android" } });

// The website serves the APK from public/download; never ship a copy of the APK inside itself.
rmSync(join(root, "out", "download"), { recursive: true, force: true });

console.log("\n> Sync web assets into the Android project");
if (!existsSync(join(root, "android"))) run("npx cap add android");
run("npx cap sync android");

console.log(`\n> Gradle ${release ? "release" : "debug"} build`);
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
run(`${gradlew} ${release ? "assembleRelease" : "assembleDebug"}`, { cwd: join(root, "android") });

const variant = release ? "release" : "debug";
const apk = join(root, "android", "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
const target = join(root, "public", "download", "parkline.apk");
mkdirSync(join(root, "public", "download"), { recursive: true });
copyFileSync(apk, target);
console.log(`\n> APK ready: ${target} (${(statSync(target).size / 1048576).toFixed(1)} MB)`);
