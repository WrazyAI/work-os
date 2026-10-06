import { describe, expect, it } from "vitest";
import { isMacOS } from "./platform";

describe("Mac presentation", () => {
  it("recognizes Intel and Apple Silicon WKWebView user agents", () => {
    expect(isMacOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe(true);
    expect(isMacOS("Mozilla/5.0 (Macintosh; ARM Mac OS X 14_0) AppleWebKit/605.1.15")).toBe(true);
    expect(isMacOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isMacOS("")).toBe(false);
  });
});
