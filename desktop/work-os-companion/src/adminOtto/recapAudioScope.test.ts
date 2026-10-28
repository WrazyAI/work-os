import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recapAudioScopeKey } from "./recapAudioScope";

const source = () => readFileSync(new URL("./useAdminOttoRecapAudio.ts", import.meta.url), "utf8");

describe("admin recap audio scope identity", () => {
  const scope = { userId: "user-1", organizationId: "org-1", mode: "admin" as const };

  it("treats a recreated equal scope as the same audio scope", () => {
    // The host passes an inline object on every App render. Equal fields must
    // not look like a new scope and dispose a playing or loading recap.
    expect(recapAudioScopeKey({ ...scope })).toBe(recapAudioScopeKey(scope));
    expect(recapAudioScopeKey({ ...scope, mode: "employee" })).not.toBe(recapAudioScopeKey(scope));
  });

  it("changes on every identity field and on removal", () => {
    const base = recapAudioScopeKey(scope);
    expect(recapAudioScopeKey({ ...scope, userId: "user-2" })).not.toBe(base);
    expect(recapAudioScopeKey({ ...scope, organizationId: "org-2" })).not.toBe(base);
    expect(recapAudioScopeKey(null)).not.toBe(base);
    expect(recapAudioScopeKey(null)).toBe(recapAudioScopeKey(null));
  });

  it("keys the player effect on the fields rather than the scope object", () => {
    const text = source();
    expect(text).toContain("const scopeKey = recapAudioScopeKey(input.scope);");
    expect(text).toContain("[scopeKey, input.epoch, input.enabled, releaseLease]");
    expect(text).not.toContain("[input.scope, input.epoch, input.enabled, releaseLease]");
    // The effect must use the latest fields, not the values captured when the
    // equal object was first rendered.
    expect(text).toContain("const scope = inputRef.current.scope;");
    expect(text).toContain("const epoch = inputRef.current.epoch;");
  });
});
