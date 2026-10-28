import { describe, expect, it } from "vitest";
import { createAvatarContextController } from "./avatarContext";
import type { OttoContextEvent } from "./mode";

const first = { userId: "one", organizationId: "org", role: "admin" };
const event = (userId = "one", epoch = 5): OttoContextEvent => ({ scope: { userId, organizationId: "org", mode: "admin" }, epoch });
describe("avatar authoritative session lifecycle", () => {
  it("stops immediately on token replacement and fences delayed old identity/context", async () => {
    const contexts: Array<OttoContextEvent | null> = [];
    let stops = 0;
    const controller = createAvatarContextController({ onContext: (context) => contexts.push(context), stopActiveWork: () => { stops++; } });
    await controller.sessionChanged(async () => first);
    controller.receive(event());
    let resolveOld!: (value: typeof first) => void;
    const old = controller.sessionChanged(() => new Promise((done) => { resolveOld = done; }));
    expect(contexts.at(-1)).toBeNull();
    expect(stops).toBeGreaterThan(0);
    const next = controller.sessionChanged(async () => ({ ...first, userId: "two" }));
    controller.receive(event("two", 1));
    await next;
    resolveOld(first); await old;
    controller.receive(event("one", 99));
    expect(contexts.at(-1)).toEqual(event("two", 1));
    controller.clear();
    controller.receive(event("two", 1));
    expect(contexts.at(-1)).toBeNull();
  });
  it("does not adopt admin context for an authoritative employee session", async () => {
    let context: OttoContextEvent | null = null;
    const controller = createAvatarContextController({ onContext: (next) => { context = next; }, stopActiveWork: () => undefined });
    await controller.sessionChanged(async () => ({ ...first, role: "employee" }));
    controller.receive(event());
    expect(context).toBeNull();
  });
});
