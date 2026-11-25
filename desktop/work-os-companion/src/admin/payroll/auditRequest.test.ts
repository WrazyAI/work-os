import { describe, expect, it } from "vitest";
import { auditRequestKey } from "./PayrollPage";

describe("native audit submission", () => {
  it("reuses one request key while the same employee's clean retry is pending", () => {
    const first = auditRequestKey(null, "person-a");
    expect(first).toEqual({ personId: "person-a", key: expect.any(String) });
    const retry = auditRequestKey(first, "person-a");
    expect(retry).toEqual(first);
  });

  it("issues a new key when the employee changes or the previous audit was accepted", () => {
    const previous = auditRequestKey(null, "person-a");
    expect(auditRequestKey(previous, "person-b")).toEqual({ personId: "person-b", key: expect.any(String) });
    expect(auditRequestKey(previous, "person-b").key).not.toBe(previous.key);
    expect(auditRequestKey(null, "person-a").key).not.toBe(previous.key);
  });
});
