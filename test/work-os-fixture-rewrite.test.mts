import assert from "node:assert/strict";
import { rewritePlanSteps } from "../scripts/rotate-e2e-fixture.mts";

/** Guards the TestSprite plan-step rewrite used when rotating the e2e fixture
 * password: the password fill after an email fill must move to the new value
 * in both its description text and its structured input, and unrelated steps
 * must stay byte-identical. */

// 1. Description-only plans (the shape stored on the prod-audit tests).
{
  const steps = [
    { type: "action", description: "Navigate to https://app.wrazyos.com/login" },
    { type: "action", description: "Fill 'e2e-verify@wrazyos.com' into email field" },
    { type: "action", description: "Fill 'OldPass123' into password field" },
    { type: "action", description: "Click 'Sign in button'" },
  ];
  const outcome = rewritePlanSteps(steps, { email: "e2e-verify@wrazyos.com", newPassword: "NewPass456" });
  assert.equal(outcome.passwordSteps, 1);
  assert.equal(outcome.steps[2].description, "Fill 'NewPass456' into password field");
  assert.equal(steps[2].description, "Fill 'OldPass123' into password field");
  assert.equal(outcome.steps[0].description, steps[0].description);
  assert.equal(outcome.steps[3].description, steps[3].description);
}

// 2. Structured input is rewritten even when the description is generic.
{
  const steps = [
    { type: "action", description: "Fill 'e2e-verify@wrazyos.com' into email field", input: "e2e-verify@wrazyos.com" },
    { type: "action", description: "Type the password", input: "OldPass123" },
  ];
  const outcome = rewritePlanSteps(steps, { email: "e2e-verify@wrazyos.com", newPassword: "NewPass456" });
  assert.equal(outcome.passwordSteps, 1);
  assert.equal(outcome.steps[1].input, "NewPass456");
  assert.equal(outcome.steps[1].description, "Type the password");
}

// 3. Multiple logins in one plan are each rewritten.
{
  const steps = [
    { description: "Fill 'e2e-verify@wrazyos.com' into email field" },
    { description: "Fill 'OldPass123' into password field" },
    { description: "Click 'Sign in button'" },
    { description: "Fill 'e2e-verify@wrazyos.com' into email field" },
    { description: "Fill 'OldPass123' into password field" },
  ];
  const outcome = rewritePlanSteps(steps, { email: "e2e-verify@wrazyos.com", newPassword: "NewPass456" });
  assert.equal(outcome.emailSteps, 2);
  assert.equal(outcome.passwordSteps, 2);
  assert.equal(outcome.steps[1].description, "Fill 'NewPass456' into password field");
  assert.equal(outcome.steps[4].description, "Fill 'NewPass456' into password field");
}

// 4. Other accounts' plans are untouched.
{
  const steps = [
    { description: "Fill 'someone@example.com' into email field" },
    { description: "Fill 'TheirPass' into password field" },
  ];
  const outcome = rewritePlanSteps(steps, { email: "e2e-verify@wrazyos.com", newPassword: "NewPass456" });
  assert.equal(outcome.changed, false);
  assert.deepEqual(outcome.steps, steps);
}

// 5. An email fill with no adjacent password fill is left alone.
{
  const steps = [
    { description: "Fill 'e2e-verify@wrazyos.com' into email field" },
    { description: "Click 'Continue button'" },
  ];
  const outcome = rewritePlanSteps(steps, { email: "e2e-verify@wrazyos.com", newPassword: "NewPass456" });
  assert.equal(outcome.changed, false);
}

// 6. A changed fixture email rewrites the email fill as well.
{
  const steps = [
    { description: "Fill 'e2e-verify@wrazyos.com' into email field" },
    { description: "Fill 'OldPass123' into password field" },
  ];
  const outcome = rewritePlanSteps(steps, {
    email: "e2e-verify@wrazyos.com",
    newEmail: "e2e-verify@maigreeks.com",
    newPassword: "NewPass456",
  });
  assert.equal(outcome.emailSteps, 1);
  assert.equal(outcome.emailRewrites, 1);
  assert.equal(outcome.passwordSteps, 1);
  assert.equal(outcome.steps[0].description, "Fill 'e2e-verify@maigreeks.com' into email field");
  assert.equal(outcome.steps[1].description, "Fill 'NewPass456' into password field");
}

// 7. Without --new-email the email fill stays byte-identical.
{
  const steps = [
    { description: "Fill 'e2e-verify@maigreeks.com' into email field" },
    { description: "Fill 'OldPass123' into password field" },
  ];
  const outcome = rewritePlanSteps(steps, { email: "e2e-verify@maigreeks.com", newPassword: "NewPass456" });
  assert.equal(outcome.emailRewrites, 0);
  assert.equal(outcome.steps[0].description, "Fill 'e2e-verify@maigreeks.com' into email field");
}

// 8. Re-running a rewrite with current values is a no-op.
{
  const steps = [
    { description: "Fill 'e2e-verify@wrazyos.com' into email field" },
    { description: "Fill 'NewPass456' into password field" },
  ];
  const outcome = rewritePlanSteps(steps, { email: "e2e-verify@wrazyos.com", newPassword: "NewPass456" });
  assert.equal(outcome.changed, false);
  assert.equal(outcome.passwordSteps, 0);
  assert.deepEqual(outcome.steps, steps);
}

// 9. Platform secret references resolve at run time and are left untouched.
{
  const steps = [
    { description: "Fill 'e2e-verify@wrazyos.com' into email field" },
    { description: "Fill '<secret>credential</secret>' into password field" },
  ];
  const outcome = rewritePlanSteps(steps, { email: "e2e-verify@wrazyos.com", newPassword: "NewPass456" });
  assert.equal(outcome.changed, false);
  assert.deepEqual(outcome.steps, steps);
}
