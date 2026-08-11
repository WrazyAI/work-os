import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const raw = process.env.WORK_OS_PROVIDER_SECRET_KEY?.trim();
  if (!raw) throw new Error("WORK_OS_PROVIDER_SECRET_KEY is required for organization provider credentials");
  const value = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (value.length !== 32) throw new Error("WORK_OS_PROVIDER_SECRET_KEY must decode to 32 bytes");
  return value;
}

export function encryptProviderSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${Buffer.concat([cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

export function decryptProviderSecret(value: string) {
  const [ivValue, payloadValue] = value.split(".");
  const iv = Buffer.from(ivValue || "", "base64");
  const payload = Buffer.from(payloadValue || "", "base64");
  if (iv.length !== 12 || payload.length < 17) throw new Error("encrypted provider credential is invalid");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(payload.subarray(0, 16));
  return Buffer.concat([decipher.update(payload.subarray(16)), decipher.final()]).toString("utf8");
}
