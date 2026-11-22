import { CapacitorHttp } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";
import { updateFeed, verifyAndroidUpdate } from "./android-update-manifest";

let check: Promise<void> | undefined;

export function stageAndroidUpdate() {
  return check ??= stageUpdate();
}

async function stageUpdate() {
  const { currentBundleId } = await LiveUpdate.ready();
  const { versionCode } = await LiveUpdate.getVersionCode();
  if (!/^\d+$/.test(versionCode)) return;
  const stem = `parkline-android-v${versionCode}`;
  const storageKey = `parkline-update-v${versionCode}`;
  const current = Math.max(Number(currentBundleId?.split("-").at(-1)) || 0, Number(localStorage.getItem(storageKey)) || 0);
  const response = await CapacitorHttp.get({
    url: `${updateFeed}${stem}.json?check=${Date.now()}`,
    responseType: "json",
    connectTimeout: 8000,
    readTimeout: 8000,
  });
  if (response.status !== 200) return;
  const pem = await fetch("/android-update-key.pem");
  if (!pem.ok) return;
  const update = await verifyAndroidUpdate(response.data, await pem.text(), versionCode, current);
  if (!update) return;

  const bundleId = `${stem}-${update.build}`;
  const { bundleIds: blocked } = await LiveUpdate.getBlockedBundles();
  if (blocked.includes(bundleId)) return;
  const { bundleIds } = await LiveUpdate.getBundles();
  if (!bundleIds.includes(bundleId)) {
    await LiveUpdate.downloadBundle({ bundleId, url: updateFeed + bundleId + ".zip", signature: update.archiveSignature });
  }
  await LiveUpdate.setNextBundle({ bundleId });
  localStorage.setItem(storageKey, String(update.build));
}
