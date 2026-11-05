import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatTurn } from "./ChatTurn";

describe("ChatTurn mascot mode", () => {
  it("defaults employee turns to the employee mark", () => {
    const html = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", text: "Hello" }));
    expect(html).toContain('data-mode="employee"');
  });

  it("admin_turn_marks_use_configured_admin_crop", () => {
    const html = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", text: "Hello", mascotMode: "admin" }));
    expect(html).toContain('data-mode="admin"');
    expect(html).toContain("studio-admin-specs");
  });
});
