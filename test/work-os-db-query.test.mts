import assert from "node:assert/strict";
import { test } from "node:test";
import { splitTopLevelList } from "../src/lib/db/query";

test("or-spec splitting respects nested and()/or() groups", () => {
  assert.deepEqual(splitTopLevelList("a.eq.1,b.eq.2"), ["a.eq.1", "b.eq.2"]);
  assert.deepEqual(
    splitTopLevelList("deleted_at.lt.2026-01-01,and(upload_status.eq.pending,created_at.lt.2026-01-02)"),
    ["deleted_at.lt.2026-01-01", "and(upload_status.eq.pending,created_at.lt.2026-01-02)"],
  );
  assert.deepEqual(
    splitTopLevelList("or(a.eq.1,and(b.eq.2,c.eq.3))"),
    ["or(a.eq.1,and(b.eq.2,c.eq.3))"],
  );
});
