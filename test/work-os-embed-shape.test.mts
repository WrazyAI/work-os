import { test } from "node:test";
import assert from "node:assert/strict";
import { embeddedRow } from "../src/lib/work-os-embed-shape";

test("a has-many embed array normalizes to its single row", () => {
  assert.deepEqual(embeddedRow([{ id: "s1", deleted_at: null }]), { id: "s1", deleted_at: null });
});

test("an empty embed array normalizes to null, never a retained screenshot", () => {
  assert.equal(embeddedRow([]), null);
});

test("an object embed passes through and absent values become null", () => {
  assert.deepEqual(embeddedRow({ id: "s1" }), { id: "s1" });
  assert.equal(embeddedRow(null), null);
  assert.equal(embeddedRow(undefined), null);
  assert.equal(embeddedRow("s1"), null);
});
