import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PET_CLIPS } from "./mascotPlayback";
import { MASCOT } from "./mascot";

describe("shipped Otto atlas", () => {
  it("ships exactly the reviewed bytes with every required animation frame", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../brand/otto/atlas-build.json", import.meta.url), "utf8"));
    for (const name of ["otto-v2.png", "otto-v2.webp"]) {
      const bytes = readFileSync(new URL(`../public/otto/${name}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.sha256[name]);
      expect(bytes.length).toBeLessThan(20 * 1024 * 1024);
    }
    expect(manifest.frames).toHaveLength(73);
    for (const [state, clip] of Object.entries(PET_CLIPS)) {
      expect(manifest.frames.filter((frame: { state: string }) => frame.state === state)).toHaveLength(clip.frames);
    }
    expect(MASCOT.assets.atlas).toBe("/otto/otto-v2.webp");
  });
});
