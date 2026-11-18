import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function block(source: string, marker: string, endMarker: string) {
  const start = source.indexOf(marker);
  expect(start, `${marker} must exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start);
  expect(end, `${endMarker} must follow ${marker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("account boundaries retire recap presentation", () => {
  it("resets the presentation watermark when a sign-in retires the current card", () => {
    const handler = block(read("./AvatarApp.tsx"), 'work-os://main-session-changed', "void secureState.session()");
    expect(handler).toContain("recapSurfaceWatermark.current = null;");
    expect(handler).toContain("recapAccountRef.current = null;");
  });

  it("stops next-step playback when the person boundary changes", () => {
    const effect = block(read("./AvatarApp.tsx"), "const account = desktopSession?.organizationId && facts.personId", "}, [desktopSession?.organizationId");
    expect(effect).toContain("stopRecapRead();");
    expect(effect).toContain("stopNextStepsRead();");
  });
});
