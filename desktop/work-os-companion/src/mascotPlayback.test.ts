import { describe, expect, it } from "vitest";
import { lookDirection, movementDirection, resolvePetClip, samplePetFrame } from "./mascotPlayback";

describe("mascot interaction and playback", () => {
  it.each([[0, -100, 0], [100, 0, 4], [0, 100, 8], [-100, 0, 12], [100, -100, 2], [-100, 100, 10]])("looks toward screen vector %s,%s", (x, y, expected) => {
    expect(lookDirection(x, y)).toBe(expected);
  });
  it("rests its gaze near the face and rejects invalid positions", () => {
    expect(lookDirection(2, 3)).toBeNull();
    expect(lookDirection(Number.NaN, 30)).toBeNull();
  });
  it("ignores movement jitter and follows actual horizontal window motion", () => {
    expect(movementDirection(1)).toBeNull();
    expect(movementDirection(-12)).toBe("left");
    expect(movementDirection(12)).toBe("right");
  });
  it("keeps work, input and failure legible while the window moves", () => {
    expect(resolvePetClip({ pose: "think", movement: "right", look: 4 })).toBe("running");
    expect(resolvePetClip({ pose: "alert", movement: "right", look: 4 })).toBe("waiting");
    expect(resolvePetClip({ pose: "recover", movement: "left", look: 4 })).toBe("failed");
    expect(resolvePetClip({ pose: "focus", movement: "left", look: 4 })).toBe("running-left");
  });
  it("uses directional poses only for an awake idle character", () => {
    expect(resolvePetClip({ pose: "idle", look: 4 })).toBe("look");
    expect(resolvePetClip({ pose: "sleep", look: 4 })).toBeNull();
    expect(resolvePetClip({ pose: "rest", look: 4 })).toBeNull();
    expect(resolvePetClip({ pose: "celebrate", look: 4 })).toBe("jumping");
  });
  it("gives evidence review and greeting their own authored clips", () => {
    expect(resolvePetClip({ pose: "review" })).toBe("review");
    expect(resolvePetClip({ pose: "wave" })).toBe("waving");
  });
  it("plays one success hop then holds the landing without replaying", () => {
    expect(samplePetFrame("jumping", 0)).toBe(0);
    expect(samplePetFrame("jumping", 260)).toBe(2);
    expect(samplePetFrame("jumping", 10_000)).toBe(4);
  });
  it("loops real working motion and holds a static wait between attention windows", () => {
    expect(samplePetFrame("running", 125)).toBe(1);
    expect(samplePetFrame("running", 750)).toBe(0);
    expect(samplePetFrame("waiting", 500, false)).toBe(5);
    expect(samplePetFrame("waiting", 500, true)).toBe(3);
  });
  it("holds the neutral idle drawing before a short blink", () => {
    expect(samplePetFrame("idle", 2_000)).toBe(0);
    expect(samplePetFrame("idle", 2_900)).toBeGreaterThan(0);
  });
});
