import assert from "node:assert/strict";
import { resolveProviderAttribution } from "../src/lib/work-os-attribution";

assert.deepEqual(resolveProviderAttribution({ personId: "person-a", verified: true }), {
  personId: "person-a", method: "verified_provider_account", confidence: 1,
});
for (const metadata of [{ shared: true }, { shared_account: true }, { ambiguous: true }, { identity_status: "ambiguous" }]) {
  assert.deepEqual(resolveProviderAttribution({ personId: "person-a", verified: true, metadata }), {
    personId: null, method: "unattributed", confidence: 0,
  });
}
assert.deepEqual(resolveProviderAttribution({ personId: "person-a", verified: false }), {
  personId: null, method: "unattributed", confidence: 0,
});
assert.deepEqual(resolveProviderAttribution({ personId: null, verified: true }), {
  personId: null, method: "unattributed", confidence: 0,
});

console.log("Work OS provider attribution tests passed.");
