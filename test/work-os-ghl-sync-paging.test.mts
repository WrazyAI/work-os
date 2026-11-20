import assert from "node:assert/strict";
import test from "node:test";
import { createGhlSyncSource } from "../src/lib/work-os-ghl-sync";
import type { GhlClient } from "../src/lib/work-os-ghl-client";
import type { GhlScope } from "../src/lib/work-os-ghl-types";

const scope: GhlScope = {
  organizationId: "org-1",
  connectionId: "connection-1",
  locationId: "location-1",
};

type ReadInput = Parameters<GhlClient["read"]>[0];

/** The export endpoint pages with an opaque `cursor`. A full page must hand
 * that cursor back on the next request or the same first page is re-read
 * forever and every record after it is silently dropped. */
test("GHL message export pages with the provider cursor", async () => {
  const calls: ReadInput[] = [];
  const client: GhlClient = {
    async read(input) {
      calls.push(input);
      if (!input.query?.cursor) {
        return {
          messages: Array.from({ length: 1000 }, (_, index) => ({ id: `call-${index}` })),
          nextCursor: "page-2-cursor",
          total: 1387,
        };
      }
      return {
        messages: Array.from({ length: 387 }, (_, index) => ({ id: `call-${1000 + index}` })),
        nextCursor: null,
        total: 1387,
      };
    },
  };
  const source = createGhlSyncSource(scope, client);

  const first = await source.messages({
    channel: "Call",
    from: "2026-10-21T04:00:00.000Z",
    through: "2026-11-20T15:00:00.000Z",
    cursor: null,
    limit: 1000,
  });
  assert.equal(first.items.length, 1000);
  assert.equal(first.nextCursor, "page-2-cursor");
  assert.equal(first.capped, true);
  assert.equal("lastMessageId" in (calls[0]!.query ?? {}), false);

  const second = await source.messages({
    channel: "Call",
    from: "2026-10-21T04:00:00.000Z",
    through: "2026-11-20T15:00:00.000Z",
    cursor: first.nextCursor,
    limit: 1000,
  });
  assert.equal(second.items.length, 387);
  assert.equal(second.nextCursor, null);
  assert.equal(second.capped, false);
  assert.equal(calls[1]!.query?.cursor, "page-2-cursor");
  assert.equal("lastMessageId" in (calls[1]!.query ?? {}), false);
});
