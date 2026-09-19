import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("employee task options use local organization people rather than Nifty mappings", () => {
  const source = read("src/lib/work-os-employee-tasks.ts");
  assert.match(source, /from\("work_people"\)\.select\("id,display_name,email"\)/);
  assert.doesNotMatch(source, /not\("nifty_member_id", "is", null\)/);
  assert.match(source, /createLocalWorkOsTask/);
  assert.match(source, /Assignees must be active Work OS organization members/);
});

test("new task routes report Work OS confirmation", () => {
  const employeeRoute = read("src/app/api/work-os/me/tasks/route.ts");
  const adminRoute = read("src/app/api/work-os/tasks/route.ts");
  assert.match(employeeRoute, /providerStatus: "work_os_confirmed"/);
  assert.match(adminRoute, /providerStatus: "work_os_confirmed"/);
  assert.match(adminRoute, /createLocalWorkOsTask/);
});

test("local task updates persist local assignee ids while historical rows map them to Nifty", () => {
  const tasks = read("src/lib/work-os-tasks.ts");
  assert.match(tasks, /if \("assignee_person_ids" in patch\)/);
  assert.match(tasks, /resolveActiveTaskPeople/);
  assert.match(tasks, /allowed\.assignees = providerIds/);
});

test("assistant create and reassignment proposals use local authority", () => {
  const proposals = read("src/lib/work-os-proposals.ts");
  assert.match(proposals, /task_authority: "work_os"/);
  assert.match(proposals, /\.eq\("provider", "local"\)/);
  assert.match(proposals, /assignee_person_ids: \[await resolveBatchAssignee/);
});

test("readiness does not require a Nifty mapping for local tasks", () => {
  const readiness = read("src/lib/work-os-readiness.ts");
  assert.doesNotMatch(readiness, /addIssue\("people\.nifty_mapping_missing"/);
  assert.doesNotMatch(readiness, /requiredProviders\.push\("nifty"\)/);
});
