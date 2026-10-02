import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGithubEvent,
  formatGithubActivityBlock,
  githubObservedLines,
  githubRecordedActivityAllowlist,
  pickGithubHighlights,
  tallyGithubActivity,
  type GithubActivity,
  type GithubActivityRow,
  type GithubIdentitySet,
} from "../src/lib/work-os-github-activity";

const identities: GithubIdentitySet = { logins: new Set(["david-z-9900"]), ids: new Set(["129889183"]) };
const other: GithubIdentitySet = { logins: new Set(), ids: new Set() };

const row = (overrides: Partial<GithubActivityRow>): GithubActivityRow => ({
  person_id: "person-1",
  occurred_at: "2026-10-01T16:00:00.000Z",
  title: null,
  artifact_url: null,
  event: null,
  action: null,
  repository: "WrazyAI/work-os",
  actor_id: null,
  actor_login: null,
  run_head_sha: null,
  run_head_branch: null,
  pr_user_login: null,
  pr_user_id: null,
  pr_number: null,
  pr_title: null,
  issue_user_login: null,
  issue_user_id: null,
  issue_number: null,
  issue_title: null,
  deployment_creator_login: null,
  deployment_ref: null,
  deployment_state: null,
  review_state: null,
  review_url: null,
  push_after: null,
  push_commit_ids: [],
  push_size: null,
  ...overrides,
});

test("performed pushes are kept only for the employee's own accounts", () => {
  const push = classifyGithubEvent(row({ event: "push", actor_login: "david-z-9900", push_size: 3 }), identities, new Set());
  assert.equal(push?.relation, "performed");
  assert.equal(push?.kind, "push");
  assert.equal(push?.description, "Pushed 3 commits to WrazyAI/work-os");
  assert.equal(classifyGithubEvent(row({ event: "push", actor_login: "someone-else", push_size: 3 }), identities, new Set()), null);
  // Numeric id matching works when the login is absent from the row.
  const byId = classifyGithubEvent(row({ event: "push", actor_id: "129889183", push_size: 1 }), identities, new Set());
  assert.equal(byId?.description, "Pushed 1 commit to WrazyAI/work-os");
});

test("pull request events split performed work from consequences on the employee's PRs", () => {
  const opened = classifyGithubEvent(row({ event: "pull_request", action: "opened", actor_login: "david-z-9900", pr_number: "42", pr_title: "Recap card" }), identities, new Set());
  assert.equal(opened?.relation, "performed");
  assert.equal(opened?.description, "Pull request #42 (Recap card) opened");
  const mergedByOther = classifyGithubEvent(row({ event: "pull_request", action: "closed", actor_login: "teammate", pr_user_login: "david-z-9900", pr_number: "42", pr_title: "Recap card" }), identities, new Set());
  assert.equal(mergedByOther?.relation, "triggered");
  assert.equal(mergedByOther?.description, "Your pull request #42 (Recap card) was closed by teammate");
  assert.equal(classifyGithubEvent(row({ event: "pull_request", action: "closed", actor_login: "teammate", pr_user_login: "someone-else", pr_number: "7" }), identities, new Set()), null);
});

test("reviews are attributed to the reviewer when performed and to the author when received", () => {
  const performed = classifyGithubEvent(row({ event: "pull_request_review", actor_login: "david-z-9900", review_state: "approved", pr_number: "42" }), identities, new Set());
  assert.equal(performed?.relation, "performed");
  assert.equal(performed?.description, "Submitted a approved review on pull request #42");
  const received = classifyGithubEvent(row({ event: "pull_request_review", actor_login: "teammate", review_state: "changes requested", pr_number: "42", pr_user_login: "david-z-9900" }), identities, new Set());
  assert.equal(received?.relation, "triggered");
  assert.equal(received?.description, "Your pull request #42 received a changes requested review from teammate");
});

test("workflow runs link to the employee's same-window pushes before falling back to their account", () => {
  const linked = classifyGithubEvent(row({
    event: "workflow_run",
    actor_login: "github-actions[bot]",
    title: "Workflow success: Work OS CI",
    run_head_sha: "ABC123",
    run_head_branch: "main",
  }), identities, new Set(["abc123"]));
  assert.equal(linked?.relation, "triggered");
  assert.equal(linked?.description, "CI for your commit on main: success: Work OS CI");
  const ownRun = classifyGithubEvent(row({ event: "workflow_run", actor_login: "david-z-9900", title: "Workflow failure: Deploy", run_head_branch: "main" }), identities, new Set());
  assert.equal(ownRun?.relation, "performed");
  assert.equal(ownRun?.description, "failure: Deploy (main)");
  assert.equal(classifyGithubEvent(row({ event: "workflow_run", actor_login: "github-actions[bot]", run_head_sha: "deadbeef" }), identities, new Set(["abc123"])), null);
});

test("deployments count only when the employee created them", () => {
  const created = classifyGithubEvent(row({ event: "deployment_status", deployment_creator_login: "david-z-9900", deployment_state: "success" }), identities, new Set());
  assert.equal(created?.relation, "triggered");
  assert.equal(created?.description, "Deployment success for WrazyAI/work-os");
  assert.equal(classifyGithubEvent(row({ event: "deployment_status", deployment_creator_login: "someone-else", deployment_state: "success" }), identities, new Set()), null);
});

test("issues split opened work from updates made by others", () => {
  const opened = classifyGithubEvent(row({ event: "issues", action: "opened", actor_login: "david-z-9900", issue_number: "9", issue_title: "Flaky test" }), identities, new Set());
  assert.equal(opened?.relation, "performed");
  assert.equal(opened?.description, "Issue #9 (Flaky test) opened");
  const closed = classifyGithubEvent(row({ event: "issues", action: "closed", actor_login: "teammate", issue_user_login: "david-z-9900", issue_number: "9" }), identities, new Set());
  assert.equal(closed?.relation, "triggered");
  assert.equal(closed?.description, "Your issue #9 was closed by teammate");
});

test("the tally counts kinds, relations, and pushed commits", () => {
  const items = [
    classifyGithubEvent(row({ event: "push", actor_login: "david-z-9900", push_size: 4 }), identities, new Set()),
    classifyGithubEvent(row({ event: "push", actor_login: "david-z-9900", push_size: 2 }), identities, new Set()),
    classifyGithubEvent(row({ event: "workflow_run", actor_login: "github-actions[bot]", run_head_sha: "abc123", run_head_branch: "main" }), identities, new Set()),
  ].flatMap((item) => (item ? [item] : []));
  const counts = tallyGithubActivity(items);
  assert.equal(counts.performed.push, 2);
  assert.equal(counts.commitsPushed, 6);
  assert.equal(counts.triggered.workflow_run, 0);
});

test("highlights put performed authored work ahead of consequences", () => {
  const items = [
    classifyGithubEvent(row({ event: "workflow_run", actor_login: "github-actions[bot]", run_head_sha: "abc123", run_head_branch: "main", occurred_at: "2026-10-01T16:30:00.000Z" }), identities, new Set(["abc123"])),
    classifyGithubEvent(row({ event: "push", actor_login: "david-z-9900", push_size: 2, occurred_at: "2026-10-01T16:10:00.000Z" }), identities, new Set()),
    classifyGithubEvent(row({ event: "pull_request", action: "opened", actor_login: "david-z-9900", pr_number: "5", occurred_at: "2026-10-01T16:05:00.000Z" }), identities, new Set()),
  ].flatMap((item) => (item ? [item] : []));
  const highlights = pickGithubHighlights(items);
  assert.equal(highlights[0]?.kind, "pull_request");
  assert.equal(highlights[1]?.kind, "push");
  assert.equal(highlights[2]?.kind, "workflow_run");
  assert.equal(pickGithubHighlights(items, 1).length, 1);
});

test("the prompt block carries the legend, counts, highlights, and a char cap", () => {
  const push = classifyGithubEvent(row({ event: "push", actor_login: "david-z-9900", push_size: 3, artifact_url: "https://github.com/WrazyAI/work-os/compare/abc" }), identities, new Set());
  const run = classifyGithubEvent(row({ event: "workflow_run", actor_login: "github-actions[bot]", run_head_sha: "abc", run_head_branch: "main", title: "Workflow success: CI", artifact_url: "https://github.com/WrazyAI/work-os/actions/runs/1" }), identities, new Set(["abc"]));
  const activity: GithubActivity = {
    items: [push!, run!],
    counts: tallyGithubActivity([push!, run!]),
    scanned: 2,
    capped: false,
    identities: { logins: ["david-z-9900"], ids: [] },
  };
  const block = formatGithubActivityBlock(activity);
  assert.match(block, /Performed by this employee: 1 push \(3 commits\)\./);
  assert.match(block, /Triggered by their work: 1 workflow run\./);
  assert.match(block, /- \[performed\] Pushed 3 commits to WrazyAI\/work-os/);
  assert.match(block, /- \[triggered\] CI for your commit on main/);
  const empty = formatGithubActivityBlock({ ...activity, items: [], counts: tallyGithubActivity([]) });
  assert.equal(empty, "");
  const huge = formatGithubActivityBlock({
    ...activity,
    items: Array.from({ length: 40 }, (_, index) => ({ ...push!, description: `Pushed ${index} commits to WrazyAI/work-os with a long trailing description` })),
  });
  assert.ok(huge.length <= 1_200, "block stays under the prompt budget");
});

test("EOD observed lines lead with the tally and stay bounded", () => {
  const push = classifyGithubEvent(row({ event: "push", actor_login: "david-z-9900", push_size: 5 }), identities, new Set());
  const activity: GithubActivity = { items: [push!], counts: tallyGithubActivity([push!]), scanned: 1, capped: false, identities: { logins: [], ids: [] } };
  const lines = githubObservedLines(activity);
  assert.match(lines[0] ?? "", /Performed by this employee: 1 push \(5 commits\)/);
  assert.equal(githubObservedLines({ ...activity, items: [], counts: tallyGithubActivity([]) }).length, 0);
  assert.equal(githubRecordedActivityAllowlist(activity).length, 1);
});
