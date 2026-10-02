import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckedMoment } from "./CheckedMoment";

describe("checked confirmation animation", () => {
  it("reserves its space with a decorative placeholder before the browser mounts", () => {
    const markup = renderToStaticMarkup(createElement(CheckedMoment));
    expect(markup).toContain("checked-moment");
    expect(markup).toContain('data-lottie="pending"');
    // Decorative art stays out of the accessibility tree; the copy carries the
    // confirmation.
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("canvas");
  });
});
