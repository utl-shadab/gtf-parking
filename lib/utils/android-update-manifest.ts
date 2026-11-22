export const updateFeed = "https://github.com/utl-shadab/gtf-parking/releases/download/android-live/";

const rsa = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const rsaSignature = /^[A-Za-z0-9+/]{512}$/;

export async function verifyAndroidUpdate(envelope: unknown, pem: string, nativeVersion: string, current: number) {
  if (typeof envelope !== "object" || envelope === null || !("payload" in envelope) || !("signature" in envelope)) return;
  const { payload, signature } = envelope;
  if (typeof payload !== "string" || payload.length > 900 || typeof signature !== "string" || !rsaSignature.test(signature)) return;

  const decode = (base64: string) => Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0));
  const key = await crypto.subtle.importKey("spki", decode(pem.replace(/-----[^-]+-----|\s/g, "")), rsa, false, ["verify"]);
  if (!await crypto.subtle.verify(rsa.name, key, decode(signature), new TextEncoder().encode(payload))) return;

  const release: unknown = JSON.parse(payload);
  if (typeof release !== "object" || release === null || !("nativeVersion" in release) || !("build" in release)
    || !("archiveSignature" in release)) return;
  const { build, archiveSignature } = release;
  if (release.nativeVersion !== nativeVersion || typeof build !== "number" || !Number.isSafeInteger(build) || build <= current
    || typeof archiveSignature !== "string" || !rsaSignature.test(archiveSignature)) return;
  return { build, archiveSignature };
}
