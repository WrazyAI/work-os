# Workspace identity and device connection

**Use when:** Changing workspace selection, membership presentation, or browser-to-companion connection.

**Owns:** Workspace choice, server-verified membership, and device handoff states.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing the first-run stage: [First run and setup](onboarding.md).
- Changing role or view routing: [Web employee workspace](web-workspace.md).

**Implementation starting points:** [page.tsx](../../../src/app/work-os/select-workspace/page.tsx), [page.tsx](../../../src/app/work-os/desktop/connect/page.tsx).

An account can belong to more than one Work OS workspace. The active workspace is
explicit and visible, never an implicit oldest or most-privileged membership:

- An account with one active membership enters it directly. An account with two
  or more and no chosen workspace lands on `/work-os/select-workspace`, which
  lists only that account's own memberships with each role, one plain POST per
  workspace. Choosing one returns to `/work-os/workspace`, where the dispatcher applies
  the role.
- The web stores the choice in the per-device `work-os-org` cookie. The server
  verifies the membership on every request; the cookie selects among verified
  memberships and is never an authorization boundary. A stale choice falls back
  to the only remaining membership, or to the chooser when more than one
  remains.
- The active workspace name sits in the administration masthead and in the
  employee workspace band, with a `Switch workspace` link whenever a second
  membership exists. The band is absent for a single-workspace employee, so the
  quiet default composition is unchanged.
- The desktop connect screen names the workspace and requires the choice before
  it authorizes the device; the resulting device session is bound to that
  workspace. A workspace without a mapped workday is not offered as a companion
  choice, and the screen says so.
- The browser round-trip hands off automatically. After approval the web screen
  keeps the authorized device on screen and attempts the companion handoff once
  as soon as the callback is issued, so the employee does not have to press
  again. Because a browser may refuse an external-protocol launch without a
  fresh press, the same `Open Work OS` action stays visible as the fallback.
  The companion keeps a visible waiting state with a `Reopen browser` action
  until the callback lands, and the page names the signed-in account and the
  chosen workspace before the decision.
