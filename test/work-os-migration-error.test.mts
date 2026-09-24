import assert from "node:assert/strict";
import test from "node:test";

import { ensureNoError, WorkOsMigrationRequiredError } from "../src/lib/work-os-internal";

test("a missing sorted-history RPC is reported as a migration-required error", async () => {
  const missingFunction = Promise.resolve({
    data: null,
    error: {
      message: "function public.work_list_person_tasks_sorted(uuid, uuid, text, boolean, text, text, date, integer, integer) does not exist",
    },
  });

  await assert.rejects(
    ensureNoError(missingFunction, "load sorted task history"),
    WorkOsMigrationRequiredError,
  );
});

test("sorted-history RPC failures retain their operation context", async () => {
  const rpcFailure = Promise.resolve({ data: null, error: { message: "permission denied for function work_list_person_tasks_sorted" } });

  await assert.rejects(
    ensureNoError(rpcFailure, "load sorted task history"),
    /load sorted task history: permission denied for function work_list_person_tasks_sorted/,
  );
});
