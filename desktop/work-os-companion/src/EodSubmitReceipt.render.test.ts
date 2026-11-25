import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EodSubmitReceipt } from "./EodSubmitReceipt";

const base = { date: "2026-09-14", onAllEods: () => undefined };

describe("EodSubmitReceipt", () => {
  it("announces a queued report without claiming delivery", () => {
    const html = renderToStaticMarkup(createElement(EodSubmitReceipt, { ...base, queued: true }));
    expect(html).toContain("EOD queued");
    expect(html).toContain("Queued on this device");
    expect(html).toContain("will be sent when the connection returns");
    expect(html).not.toContain("EOD submitted");
    expect(html).not.toContain("checked-moment");
  });

  it("shows the success check only for a delivered report", () => {
    const html = renderToStaticMarkup(createElement(EodSubmitReceipt, { ...base, queued: false }));
    expect(html).toContain("EOD submitted");
    expect(html).toContain("with your manager");
    expect(html).toContain("checked-moment");
    expect(html).not.toContain("Queued on this device");
  });
});
