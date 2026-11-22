import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { verifyAndroidUpdate } from "../lib/utils/android-update-manifest.ts";

test("only signed, newer Android bundles for the installed native version are eligible", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const archiveSignature = sign("sha256", Buffer.from("Parkline bundle"), privateKey).toString("base64");
  const payload = JSON.stringify({ nativeVersion: "2", build: 17, archiveSignature });
  const signature = sign("sha256", Buffer.from(payload), privateKey).toString("base64");
  const envelope = { payload, signature };

  assert.deepEqual(await verifyAndroidUpdate(envelope, pem, "2", 16), { build: 17, archiveSignature });
  assert.equal(await verifyAndroidUpdate(envelope, pem, "2", 17), undefined);
  assert.equal(await verifyAndroidUpdate(envelope, pem, "3", 0), undefined);
  assert.equal(await verifyAndroidUpdate({ ...envelope, payload: payload.replace("17", "18") }, pem, "2", 16), undefined);
  assert.equal(await verifyAndroidUpdate({ payload }, pem, "2", 16), undefined);
});
