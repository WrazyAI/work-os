import { describe, expect, it } from "vitest";
import { auditRequestKey } from "./PayrollPage";

const window = { personId: "person-a", from: "2026-11-01", through: "2026-11-10" };

describe("native audit submission", () => {
  it("reuses one request key while the same employee and window retry is pending", () => {
    const first = auditRequestKey(null, window);
    expect(first).toEqual({ ...window, key: expect.any(String) });
    expect(auditRequestKey(first, window)).toEqual(first);
  });

  it("issues a new key when the employee, start or end changes", () => {
    const previous = auditRequestKey(null, window);
    for (const changed of [
      { ...window, personId: "person-b" },
      { ...window, from: "2026-11-02" },
      { ...window, through: "2026-11-11" },
    ]) {
      const next = auditRequestKey(previous, changed);
      expect(next.key).not.toBe(previous.key);
      expect(next).toMatchObject(changed);
    }
    expect(auditRequestKey(null, window).key).not.toBe(previous.key);
  });
});
