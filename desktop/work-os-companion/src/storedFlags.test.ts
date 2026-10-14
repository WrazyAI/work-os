import { describe, expect, it } from "vitest";
import { readStoredFlag, writeStoredFlag } from "./storedFlags";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("storedFlags", () => {
  it("reads and writes device-local boolean flags", () => {
    const storage = fakeStorage();
    expect(readStoredFlag("work-os.test.flag", false, storage)).toBe(false);
    writeStoredFlag("work-os.test.flag", true, storage);
    expect(storage.values.get("work-os.test.flag")).toBe("true");
    expect(readStoredFlag("work-os.test.flag", false, storage)).toBe(true);
    writeStoredFlag("work-os.test.flag", false, storage);
    expect(readStoredFlag("work-os.test.flag", true, storage)).toBe(false);
  });

  it("falls back without a key, storage, or readable value", () => {
    expect(readStoredFlag(null, true, fakeStorage())).toBe(true);
    expect(readStoredFlag("work-os.test.flag", true, null)).toBe(true);
    const blocked = {
      getItem: (): string | null => { throw new Error("blocked"); },
      setItem: (): void => { throw new Error("blocked"); },
    };
    expect(readStoredFlag("work-os.test.flag", false, blocked)).toBe(false);
    expect(() => writeStoredFlag("work-os.test.flag", true, blocked)).not.toThrow();
    expect(readStoredFlag("work-os.test.flag", false, fakeStorage({ "work-os.test.flag": "unexpected" }))).toBe(false);
  });
});
