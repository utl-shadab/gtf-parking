// Builds the Android APK and publishes it for the website's install prompt.
//   node scripts/build-android.mjs            -> debug APK (installable, unsigned for the store)
//   node scripts/build-android.mjs --release  -> signed release APK (needs android/keystore.properties)
import { execSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { zipSync } from "three/addons/libs/fflate.module.js";

const root = process.cwd();
const release = process.argv.includes("--release");
const update = process.argv[2] === "--update" ? Number(process.argv[3]) : null;
const web = join(root, "out");
const run = (command, options = {}) => execSync(command, { stdio: "inherit", cwd: root, ...options });

let signer;
if (update !== null) {
  if (!Number.isSafeInteger(update) || update < 1) throw new Error("Supply a positive, increasing live-update build number");
  const keyPath = process.env.PARKLINE_UPDATE_KEY_FILE ??
    join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "Parkline", "android-live-update-private.pem");
  signer = createPrivateKey(readFileSync(keyPath));
  const trustedKey = createPublicKey(readFileSync(join(root, "public", "android-update-key.pem")));
  if (!createPublicKey(signer).equals(trustedKey)) throw new Error("The signing key does not match the key trusted by the APK");
}

console.log("\n> Static export for Android");
rmSync(web, { recursive: true, force: true });
run("npx next build", { env: { ...process.env, BUILD_TARGET: "android" } });

// The website serves the APK from public/download; never ship a copy of the APK inside itself.
rmSync(join(web, "download"), { recursive: true, force: true });
rmSync(join(web, "fonts", "game-paused-demo.otf"), { force: true });

if (signer) {
  const nativeVersion = readFileSync(join(root, "android", "app", "build.gradle"), "utf8")
    .match(/^\s*versionCode\s+(\d+)\s*$/m)?.[1];
  if (!nativeVersion || !existsSync(join(web, "index.html"))) throw new Error("Android version code or exported entry page is missing");
  const files = Object.fromEntries(readdirSync(web, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(web, path).replaceAll("\\", "/"), readFileSync(path)];
    }));
  const archive = zipSync(files, { level: 6 });
  const signed = (data) => sign("sha256", data, signer).toString("base64");
  const payload = JSON.stringify({ nativeVersion, build: update, archiveSignature: signed(archive) });
  const output = join(root, "android", "app", "build", "outputs", "live-updates", String(update));
  mkdirSync(output, { recursive: true });
  const stem = `parkline-android-v${nativeVersion}`;
  writeFileSync(join(output, `${stem}-${update}.zip`), archive);
  writeFileSync(join(output, `${stem}.json`), JSON.stringify({ payload, signature: signed(Buffer.from(payload)) }));
  console.log(`\n> Signed live update ready: ${output}`);
  process.exit(0);
}

console.log("\n> Sync web assets into the Android project");
if (!existsSync(join(root, "android"))) run("npx cap add android");
run("npx cap sync android");

console.log(`\n> Gradle ${release ? "release" : "debug"} build`);
// Full path: Windows shells may be set to never run programs from the current directory.
const gradlew = join(root, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
run(`"${gradlew}" ${release ? "assembleRelease" : "assembleDebug"}`, { cwd: join(root, "android") });

const variant = release ? "release" : "debug";
const apk = join(root, "android", "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
const target = join(root, "public", "download", "parkline.apk");
mkdirSync(join(root, "public", "download"), { recursive: true });
copyFileSync(apk, target);
console.log(`\n> APK ready: ${target} (${(statSync(target).size / 1048576).toFixed(1)} MB)`);
