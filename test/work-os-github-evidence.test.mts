import { test } from "node:test";
import assert from "node:assert/strict";
import { githubObservation } from "../src/lib/work-os-provider-webhooks";
import { groupEvidenceActors, suggestPersonForActor } from "../src/lib/work-os-evidence-actors";

const REPOSITORY = { full_name: "WrazyAI/work-os", default_branch: "main", owner: { id: 289751878, login: "WrazyAI" } };
const SENDER = { id: 129889183, login: "zahemen9900" };

test("default-branch pushes become one evidence observation attributed to the commit author", () => {
  const observation = githubObservation("push", {
    ref: "refs/heads/main",
    deleted: false,
    size: 2,
    compare: "https://github.com/WrazyAI/work-os/compare/a...b",
    repository: REPOSITORY,
    head_commit: { id: "abcdef1234567890", message: "Fix the thing", timestamp: "2026-10-01T10:00:00Z", author: { username: "david-z-9900" } },
    commits: [
      { id: "abcdef1234567890", message: "Fix the thing" },
      { id: "1234567890abcdef", message: "Clean up" },
    ],
    sender: SENDER,
  });
  assert.ok(observation);
  assert.equal(observation.title, "Pushed 2 commits to main");
  assert.match(observation.summary, /WrazyAI\/work-os/);
  assert.match(observation.summary, /abcdef1 Fix the thing/);
  assert.match(observation.summary, /1234567 Clean up/);
  assert.equal(observation.artifactUrl, "https://github.com/WrazyAI/work-os/compare/a...b");
  assert.deepEqual(observation.actor, { id: null, login: "david-z-9900" });
});

test("non-default-branch and deleted pushes are not evidence", () => {
  assert.equal(githubObservation("push", { ref: "refs/heads/feature", repository: REPOSITORY, commits: [{ id: "aaaaaaa", message: "wip" }] }), null);
  assert.equal(githubObservation("push", { ref: "refs/heads/main", deleted: true, repository: REPOSITORY, commits: [{ id: "aaaaaaa", message: "wip" }] }), null);
  assert.equal(githubObservation("push", { ref: "refs/heads/main", repository: REPOSITORY, size: 0, commits: [] }), null);
});

test("push falls back to the sender when the commit author has no GitHub login", () => {
  const observation = githubObservation("push", {
    ref: "refs/heads/main",
    size: 1,
    repository: REPOSITORY,
    head_commit: { id: "abcdef1234567890", message: "Fix", timestamp: "2026-10-01T10:00:00Z", author: { name: "Someone", email: "someone@example.com" } },
    commits: [{ id: "abcdef1234567890", message: "Fix" }],
    sender: SENDER,
  });
  assert.deepEqual(observation?.actor, { id: "129889183", login: "zahemen9900" });
});

test("pull requests are evidence only when opened or closed, and belong to the author", () => {
  const opened = githubObservation("pull_request", {
    action: "opened",
    pull_request: { number: 7, title: "Add evidence", html_url: "https://github.com/WrazyAI/work-os/pull/7", user: { id: 288747123, login: "david-z-9900" }, created_at: "2026-10-01T09:00:00Z" },
    repository: REPOSITORY,
    sender: SENDER,
  });
  assert.equal(opened?.title, "Pull request opened: Add evidence");
  assert.deepEqual(opened?.actor, { id: "288747123", login: "david-z-9900" });

  const merged = githubObservation("pull_request", {
    action: "closed",
    pull_request: { number: 7, title: "Add evidence", merged: true, merged_at: "2026-10-01T11:00:00Z", user: { id: 288747123, login: "david-z-9900" } },
    repository: REPOSITORY,
    sender: SENDER,
  });
  assert.equal(merged?.title, "Pull request merged: Add evidence");

  const closed = githubObservation("pull_request", {
    action: "closed",
    pull_request: { number: 8, title: "Abandoned", merged: false, closed_at: "2026-10-01T11:00:00Z", user: { id: 288747123, login: "david-z-9900" } },
    repository: REPOSITORY,
    sender: SENDER,
  });
  assert.equal(closed?.title, "Pull request closed without merging: Abandoned");

  assert.equal(githubObservation("pull_request", { action: "synchronize", pull_request: { number: 7 }, repository: REPOSITORY, sender: SENDER }), null);
});

test("reviews only count when submitted and belong to the reviewer", () => {
  const review = githubObservation("pull_request_review", {
    action: "submitted",
    review: { state: "approved", submitted_at: "2026-10-01T12:00:00Z" },
    pull_request: { number: 9, title: "Ship it", html_url: "https://github.com/WrazyAI/work-os/pull/9" },
    repository: REPOSITORY,
    sender: SENDER,
  });
  assert.equal(review?.title, "Pull request review approved: Ship it");
  assert.deepEqual(review?.actor, { id: "129889183", login: "zahemen9900" });
  assert.equal(githubObservation("pull_request_review", { action: "dismissed", review: { state: "approved" }, repository: REPOSITORY, sender: SENDER }), null);
});

test("workflow runs only count when completed, issues only on open or close", () => {
  const run = githubObservation("workflow_run", {
    action: "completed",
    workflow_run: { id: 42, name: "CI", conclusion: "success", head_branch: "main", html_url: "https://github.com/WrazyAI/work-os/actions/runs/42", updated_at: "2026-10-01T13:00:00Z" },
    repository: REPOSITORY,
    sender: SENDER,
  });
  assert.equal(run?.title, "Workflow success: CI");
  assert.equal(githubObservation("workflow_run", { action: "in_progress", workflow_run: { id: 42 }, repository: REPOSITORY, sender: SENDER }), null);

  const issue = githubObservation("issues", {
    action: "opened",
    issue: { number: 3, title: "Commit evidence is missing", html_url: "https://github.com/WrazyAI/work-os/issues/3", created_at: "2026-10-01T14:00:00Z" },
    repository: REPOSITORY,
    sender: SENDER,
  });
  assert.equal(issue?.title, "Issue opened: Commit evidence is missing");
  assert.equal(githubObservation("issues", { action: "labeled", issue: { number: 3 }, repository: REPOSITORY, sender: SENDER }), null);
});

test("actor grouping merges one person's push and pull request events", () => {
  const rows = [
    { person_id: null, occurred_at: "2026-10-01T10:00:00Z", title: "Pushed 2 commits to main", metadata: { actor: { id: null, login: "david-z-9900" } } },
    { person_id: null, occurred_at: "2026-10-01T11:00:00Z", title: "Pull request merged: Add evidence", metadata: { actor: { id: "288747123", login: "david-z-9900" } } },
    { person_id: null, occurred_at: "2026-10-01T09:00:00Z", title: "Pull request opened: Something", metadata: { actor: { id: "288747123", login: "david-z-9900" } } },
    { person_id: "p1", occurred_at: "2026-10-01T12:00:00Z", title: "Already attributed", metadata: { actor: { id: "1", login: "someone" } } },
  ];
  const actors = groupEvidenceActors(rows);
  assert.equal(actors.length, 1);
  assert.equal(actors[0].login, "david-z-9900");
  assert.equal(actors[0].id, "288747123");
  assert.equal(actors[0].events, 3);
  assert.equal(actors[0].lastSeen, "2026-10-01T11:00:00.000Z");
  assert.equal(actors[0].firstSeen, "2026-10-01T09:00:00.000Z");
  assert.equal(actors[0].titles.length, 3);
});

test("actor grouping falls back to the raw sender and skips anonymous events", () => {
  const actors = groupEvidenceActors([
    { person_id: null, occurred_at: "2026-10-01T10:00:00Z", title: "Old event", metadata: {}, raw: { sender: { id: 777, login: "platoya" } } },
    { person_id: null, occurred_at: "2026-10-01T10:00:00Z", title: "No actor", metadata: {}, raw: {} },
  ]);
  assert.equal(actors.length, 1);
  assert.equal(actors[0].login, "platoya");
  assert.equal(actors[0].id, "777");
});

test("a person's github username suggests the mapping", () => {
  const people = [
    { id: "p1", display_name: "David Z", github_username: "david-z-9900" },
    { id: "p2", display_name: "Someone Else", github_username: null },
  ];
  assert.deepEqual(suggestPersonForActor({ id: "1", login: "David-Z-9900" }, people), { personId: "p1", displayName: "David Z", githubUsername: "david-z-9900" });
  assert.equal(suggestPersonForActor({ id: "1", login: "nobody" }, people), null);
  assert.equal(suggestPersonForActor({ id: "1", login: null }, people), null);
});
