import { describe, expect, it } from "vitest";
import { workProfileCatalog } from "@wrazy/work-os-shared/onboarding";
import { PREVIEW_DATA } from "./OnboardingPreview";

describe("onboarding layout fixture", () => {
  it("uses the complete production catalog so the scope step really overflows", () => {
    expect(PREVIEW_DATA.catalog).toEqual(workProfileCatalog());
  });
});
