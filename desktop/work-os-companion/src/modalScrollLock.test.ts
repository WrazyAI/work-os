import { describe, expect, it } from "vitest";
import { acquireModalScrollLock, type ModalDocument } from "./modalScrollLock";

function classTarget() {
  const values = new Set<string>();
  const style = { position: "", top: "", width: "" };
  const classList = {
    add: (...names: string[]) => names.forEach((name) => values.add(name)),
    remove: (...names: string[]) => names.forEach((name) => values.delete(name)),
    contains: (name: string) => values.has(name),
  };
  return { classList, style, values };
}

function modalDocument(): { target: ModalDocument; html: ReturnType<typeof classTarget>; body: ReturnType<typeof classTarget> } {
  const html = classTarget();
  const body = classTarget();
  return {
    html,
    body,
    target: { documentElement: html, body } as unknown as ModalDocument,
  };
}

describe("modal scroll lock", () => {
  it("keeps both document roots locked until the last modal closes", () => {
    const { target, html, body } = modalDocument();
    const releaseFirst = acquireModalScrollLock(target);
    const releaseSecond = acquireModalScrollLock(target);

    expect(html.values.has("modal-open")).toBe(true);
    expect(body.values.has("modal-open")).toBe(true);
    expect(body.style.position).toBe("fixed");
    expect(body.style.top).toBe("-0px");

    releaseFirst();
    expect(html.values.has("modal-open")).toBe(true);
    expect(body.values.has("modal-open")).toBe(true);

    releaseSecond();
    expect(html.values.has("modal-open")).toBe(false);
    expect(body.values.has("modal-open")).toBe(false);
    expect(body.style.position).toBe("");
    expect(body.style.top).toBe("");
    releaseSecond();
  });

  it("does not remove a lock owned before the modal mounted", () => {
    const { target, html, body } = modalDocument();
    html.values.add("modal-open");
    body.values.add("modal-open");

    const release = acquireModalScrollLock(target);
    release();

    expect(html.values.has("modal-open")).toBe(true);
    expect(body.values.has("modal-open")).toBe(true);
  });
});
