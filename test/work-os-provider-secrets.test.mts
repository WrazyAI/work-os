import assert from "node:assert/strict";

process.env.WORK_OS_PROVIDER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
const { encryptProviderSecret, decryptProviderSecret } = await import("../src/lib/work-os-secrets");

const encrypted = encryptProviderSecret("provider-token-value");
assert.notEqual(encrypted, "provider-token-value");
assert.equal(decryptProviderSecret(encrypted), "provider-token-value");
assert.throws(() => decryptProviderSecret(`${encrypted.slice(0, -2)}aa`));

console.log("Work OS provider credential encryption tests passed.");
