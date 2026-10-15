import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { acquirePageScrollLock, type ScrollLockTarget } from "./scrollLock";

function bodyTarget(initial = "") {
  const body = { style: { overflow: initial } };
  return { body, target: { body } as unknown as ScrollLockTarget };
}

describe("administration page scroll lock", () => {
  it("restores the original inline value after the last holder releases", () => {
    const { body, target } = bodyTarget();
    const releaseFirst = acquirePageScrollLock(target);
    const releaseSecond = acquirePageScrollLock(target);

    expect(body.style.overflow).toBe("hidden");

    releaseFirst();
    expect(body.style.overflow).toBe("hidden");

    releaseSecond();
    expect(body.style.overflow).toBe("");
  });

  it("closes in either order without leaving a stale lock", () => {
    const { body, target } = bodyTarget();
    const releaseBottom = acquirePageScrollLock(target);
    const releaseTop = acquirePageScrollLock(target);

    // The reported freeze: the drawer opened first closes first.
    releaseBottom();
    expect(body.style.overflow).toBe("hidden");
    releaseTop();
    expect(body.style.overflow).toBe("");

    // The natural order, where the topmost drawer closes first.
    const releaseAgainBottom = acquirePageScrollLock(target);
    const releaseAgainTop = acquirePageScrollLock(target);
    releaseAgainTop();
    expect(body.style.overflow).toBe("hidden");
    releaseAgainBottom();
    expect(body.style.overflow).toBe("");
  });

  it("is idempotent for a double release, even while another drawer holds", () => {
    const { body, target } = bodyTarget();
    const release = acquirePageScrollLock(target);
    release();
    release();
    expect(body.style.overflow).toBe("");

    // Unmounting one owner must not release a lock another drawer still holds.
    const held = acquirePageScrollLock(target);
    const other = acquirePageScrollLock(target);
    other();
    other();
    expect(body.style.overflow).toBe("hidden");
    held();
    expect(body.style.overflow).toBe("");
  });

  it("restores a pre-existing inline value", () => {
    const { body, target } = bodyTarget("auto");
    const release = acquirePageScrollLock(target);
    expect(body.style.overflow).toBe("hidden");
    release();
    expect(body.style.overflow).toBe("auto");
  });

  it("tolerates rapid open/close cycles", () => {
    const { body, target } = bodyTarget();
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const release = acquirePageScrollLock(target);
      expect(body.style.overflow).toBe("hidden");
      release();
      expect(body.style.overflow).toBe("");
    }
  });

  it("keeps the drawer the only body-overflow writer in the workspace", () => {
    const ui = readFileSync(fileURLToPath(new URL("./ui.tsx", import.meta.url)), "utf8");
    expect(ui).toContain("acquirePageScrollLock()");
    // Per-instance capture/restore is what left a stale lock behind.
    expect(ui).not.toContain("document.body.style.overflow");
  });
});
