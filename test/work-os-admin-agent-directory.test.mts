import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminAgentPerson,
  listAdminAgentPeople,
  listAdminAgentProjects,
  parseAdminAgentPeopleFilters,
} from "../src/lib/work-admin-agent-directory";
import {
  adminAccess, designerRole, engineerRole, fixture, mappedAdminAccess, org, otherOrg,
  otherOrgAccess, otherPerson, personA, personB, personC, projectApp, projectArchived,
  projectWebsite, teamAlpha, teamBeta,
} from "./helpers/work-os-admin-agent-fixture.mts";

const filters = {
  query: null, active: true, teamId: null, role: null, limit: 50, cursor: null,
};

test("search filters by name, active state, team, and role", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const byName = await listAdminAgentPeople(adminAccess, { ...filters, query: "ada" });
    assert.deepEqual(byName.people.map((p) => p.displayName), ["Ada Lovelace"]);
    const byTeam = await listAdminAgentPeople(adminAccess, { ...filters, teamId: teamAlpha });
    assert.deepEqual(byTeam.people.map((p) => p.id), [personA]);
    const byRole = await listAdminAgentPeople(adminAccess, { ...filters, role: "Engineer" });
    assert.deepEqual(byRole.people.map((p) => p.id), [personA]);
    const inactive = await listAdminAgentPeople(adminAccess, { ...filters, active: false });
    assert.deepEqual(inactive.people.map((p) => p.id), [personC]);
  } finally {
    await f.close();
  }
});

test("the text search matches email, ignores case, and escapes LIKE wildcards", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const page = await listAdminAgentPeople(adminAccess, { ...filters, query: "GRACE@" });
    assert.deepEqual(page.people.map((p) => p.id), [personB]);
    // A bare wildcard is a literal character, not "match everyone".
    const percent = await listAdminAgentPeople(adminAccess, { ...filters, query: "%" });
    assert.deepEqual(percent.people, []);
    const underscore = await listAdminAgentPeople(adminAccess, { ...filters, query: "_" });
    assert.deepEqual(underscore.people, []);
  } finally {
    await f.close();
  }
});

test("people are ordered by name and the cursor walks without gaps", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const first = await listAdminAgentPeople(adminAccess, { ...filters, limit: 1 });
    assert.deepEqual(first.people.map((p) => p.displayName), ["Ada Lovelace"]);
    assert.equal(first.total, 2);
    assert.ok(first.nextCursor);

    const second = await listAdminAgentPeople(adminAccess, { ...filters, limit: 1, cursor: first.nextCursor });
    assert.deepEqual(second.people.map((p) => p.displayName), ["Grace Hopper"]);
    assert.equal(second.total, 2);
    assert.equal(second.nextCursor, null);
  } finally {
    await f.close();
  }
});

test("an invalid cursor is a validation error, not a query failure", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    await assert.rejects(
      () => listAdminAgentPeople(adminAccess, { ...filters, cursor: "not-a-cursor" }),
      (error: Error) => error.name === "WorkOsValidationError",
    );
  } finally {
    await f.close();
  }
});

test("the directory never crosses the organization boundary", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const page = await listAdminAgentPeople(otherOrgAccess, { ...filters });
    assert.deepEqual(page.people.map((p) => p.id), [otherPerson]);
  } finally {
    await f.close();
  }
});

test("a person-mapped admin token still reads the whole directory", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const page = await listAdminAgentPeople(mappedAdminAccess, { ...filters });
    assert.deepEqual(page.people.map((p) => p.id), [personA, personB]);
  } finally {
    await f.close();
  }
});

test("person detail returns schedule, role profile, manager, and teams", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const detail = await getAdminAgentPerson(adminAccess, personA);
    assert.ok(detail);
    assert.equal(detail.id, personA);
    assert.equal(detail.displayName, "Ada Lovelace");
    assert.equal(detail.email, "ada@example.com");
    assert.equal(detail.active, true);
    assert.equal(detail.timezone, "Europe/London");
    assert.deepEqual(detail.schedule, { timezone: "Europe/London" });
    assert.deepEqual(detail.roleProfile, { id: engineerRole, name: "Engineer" });
    assert.deepEqual(detail.manager, { id: personB, displayName: "Grace Hopper" });
    assert.deepEqual(detail.teams.map((team) => [team.id, team.name, team.isManager]), [
      [teamAlpha, "Alpha", false],
      [teamBeta, "Beta", false],
    ]);
  } finally {
    await f.close();
  }
});

test("person detail is null across organizations and for unknown ids", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    assert.equal(await getAdminAgentPerson(otherOrgAccess, personA), null);
    assert.equal(await getAdminAgentPerson(adminAccess, otherPerson), null);
    assert.equal(await getAdminAgentPerson(adminAccess, "00000000-0000-4000-8000-000000009999"), null);
    assert.equal(await getAdminAgentPerson(adminAccess, "not-a-uuid"), null);
  } finally {
    await f.close();
  }
});

test("person detail keeps an inactive person visible with their role", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const detail = await getAdminAgentPerson(adminAccess, personC);
    assert.ok(detail);
    assert.equal(detail.active, false);
    assert.equal(detail.roleProfile, null);
    assert.deepEqual(detail.teams, []);
  } finally {
    await f.close();
  }
});

test("role profile lookups are organization-scoped", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const page = await listAdminAgentPeople(otherOrgAccess, { ...filters, role: "Engineer", limit: 50 });
    assert.deepEqual(page.people.map((p) => p.id), [otherPerson]);
    assert.deepEqual(page.people[0].roleProfile, { id: "60000000-0000-4000-8000-000000000003", name: "Engineer" });
  } finally {
    await f.close();
  }
});

test("projects are active, non-archived, ordered by name, and organization-scoped", async () => {
  const f = await fixture();
  try {
    await f.seedDirectory();
    const projects = await listAdminAgentProjects(adminAccess);
    assert.deepEqual(projects.map((project) => project.id), [projectApp, projectWebsite]);
    assert.deepEqual(projects.map((project) => project.name), ["App", "Website"]);
    assert.ok(!projects.some((project) => project.id === projectArchived));
    assert.equal(projects[0].provider, "nifty");
    assert.equal(projects[0].providerProjectId, "pp-app");
    assert.equal(projects[0].archived, false);

    const otherProjects = await listAdminAgentProjects(otherOrgAccess);
    assert.deepEqual(otherProjects.map((project) => project.name), ["Other Site"]);
  } finally {
    await f.close();
  }
});

test("query parameters default to active people and reject bad input", () => {
  const defaults = parseAdminAgentPeopleFilters(new URLSearchParams(""));
  assert.deepEqual(defaults, {
    query: null, active: true, teamId: null, role: null, limit: 50, cursor: null,
  });

  const parsed = parseAdminAgentPeopleFilters(new URLSearchParams(
    "q=ada&active=false&team_id=" + teamAlpha + "&role=Engineer&limit=5",
  ));
  assert.deepEqual(parsed, {
    query: "ada", active: false, teamId: teamAlpha, role: "Engineer", limit: 5, cursor: null,
  });

  assert.equal(parseAdminAgentPeopleFilters(new URLSearchParams("q=%20%20")).query, null);
  assert.equal(parseAdminAgentPeopleFilters(new URLSearchParams("role=")).role, null);
  assert.equal(parseAdminAgentPeopleFilters(new URLSearchParams("active=all")).active, null);
  assert.equal(parseAdminAgentPeopleFilters(new URLSearchParams("limit=5000")).limit, 100);

  assert.throws(
    () => parseAdminAgentPeopleFilters(new URLSearchParams("active=maybe")),
    (error: Error) => error.name === "WorkOsValidationError",
  );
  assert.throws(
    () => parseAdminAgentPeopleFilters(new URLSearchParams("team_id=nope")),
    (error: Error) => error.name === "WorkOsValidationError",
  );
  assert.throws(
    () => parseAdminAgentPeopleFilters(new URLSearchParams("limit=zero")),
    (error: Error) => error.name === "WorkOsValidationError",
  );
});

test("the fixture keeps the real organization and role identities stable", () => {
  assert.notEqual(org, otherOrg);
  assert.notEqual(engineerRole, designerRole);
});
