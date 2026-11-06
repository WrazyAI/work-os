import assert from "node:assert/strict";
import test from "node:test";
import { createGhlClient, type GhlFetch } from "../src/lib/work-os-ghl-client";

const scope = {
  organizationId: "org-1",
  connectionId: "conn-1",
  locationId: "kIBcQo8BT0retpfdsHc7",
};

function recordingFetch() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: GhlFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

test("reads a documented endpoint with the location, version, and token", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const client = createGhlClient({ scope, token: "pit-secret", fetchImpl });
  const result = await client.read({ path: "/users/search", query: { companyId: "company-1", locationId: scope.locationId } });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  const [call] = calls;
  const url = new URL(call.url);
  assert.equal(url.origin, "https://services.leadconnectorhq.com");
  assert.equal(url.pathname, "/users/search");
  assert.equal(url.searchParams.get("locationId"), scope.locationId);
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer pit-secret");
  assert.equal(headers.get("Version"), "v3");
  assert.equal(headers.get("Accept"), "application/json");
});

test("rejects an unallowlisted path before any request", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const client = createGhlClient({ scope, token: "pit-secret", fetchImpl });
  await assert.rejects(() => client.read({ path: "/contacts", method: "POST", body: {} }), /not allowed/i);
  assert.equal(calls.length, 0);
});

test("area code endpoints are allowed but every mutation method is rejected", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const client = createGhlClient({ scope, token: "pit-secret", fetchImpl });
  await assert.rejects(() => client.read({ path: "/contacts/search", method: "POST", body: {} }), /not allowed/i);
  assert.equal(calls.length, 0);
});

test("rejects absolute and traversal paths", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const client = createGhlClient({ scope, token: "pit-secret", fetchImpl });
  await assert.rejects(() => client.read({ path: "https://evil.example/steal" }), /not allowed/i);
  await assert.rejects(() => client.read({ path: "/users/../../contacts" }), /not allowed/i);
  assert.equal(calls.length, 0);
});

test("location mismatch in query or body rejects before any request", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const client = createGhlClient({ scope, token: "pit-secret", fetchImpl });
  await assert.rejects(() => client.read({ path: "/contacts/contact-1/notes", query: { locationId: "other-location" } }), /location/i);
  await assert.rejects(() => client.read({ path: "/calendars/events", query: { locationId: "other-location" } }), /location/i);
  assert.equal(calls.length, 0);
});

test("reads redirect safely by not following to a different origin", async () => {
  const calls: string[] = [];
  const fetchImpl: GhlFetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return new Response(JSON.stringify({ redirect: "https://evil.example/steal" }), {
        status: 302,
        headers: { location: "https://evil.example/steal" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const client = createGhlClient({ scope, token: "pit-secret", fetchImpl });
  await assert.rejects(() => client.read({ path: "/users/VN13egA2TXXCZk90XewJ" }), /redirect|status/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes("evil.example"), false);
  assert.equal(calls[0].includes("leadconnectorhq.com"), true);
});

test("a non-2xx error names status but never token or response body", async () => {
  const fetchImpl: GhlFetch = async () => new Response("LEAKED_PROVIDER_BODY pit-secret", { status: 401 });
  const client = createGhlClient({ scope, token: "pit-secret", fetchImpl });
  await assert.rejects(
    () => client.read({ path: "/users/VN13egA2TXXCZk90XewJ" }),
    (error: Error) => {
      assert.equal(error.message.includes("LEAKED_PROVIDER_BODY"), false);
      assert.equal(error.message.includes("pit-secret"), false);
      assert.equal(error.message.includes("401"), true);
      return true;
    },
  );
});

test("network failure does not expose its raw message", async () => {
  const fetchImpl: GhlFetch = async () => {
    throw new TypeError("connect failed to host pit-secret");
  };
  const client = createGhlClient({ scope, token: "pit-secret", fetchImpl });
  await assert.rejects(
    () => client.read({ path: "/users/VN13egA2TXXCZk90XewJ" }),
    (error: Error) => {
      assert.equal(error.message.includes("pit-secret"), false);
      return true;
    },
  );
});
