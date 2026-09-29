import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { Client } from "pg";

const DEFAULT_EMAIL = "e2e-verify@maigreeks.com";
const DEFAULT_BASE = "https://app.wrazyos.com";
const DEFAULT_PROJECT = "e8fa6d35-586c-47a7-a69c-13e6b8552a0b";
const DEFAULT_TESTSRITE = "/home/zahemen/.nvm/versions/node/v24.20.0/bin/testsprite";

export interface FixturePlanStep {
  type?: string;
  description?: string;
  input?: string | null;
  [key: string]: unknown;
}

export interface RewriteOutcome {
  steps: FixturePlanStep[];
  emailSteps: number;
  emailRewrites: number;
  passwordSteps: number;
  changed: boolean;
}

function parseFill(description: string): { value: string; field: string } | null {
  const match = description.match(/^Fill '(.*)' into (.+)$/);
  return match ? { value: match[1], field: match[2] } : null;
}

/** Rewrite fixture-login fill steps to the new email and password. The first
 * password fill after an email fill is the credential; both the description
 * text and the structured input move to the new values. */
export function rewritePlanSteps(
  steps: FixturePlanStep[],
  options: { email: string; newPassword: string; newEmail?: string },
): RewriteOutcome {
  const rewritten = steps.map((step) => ({ ...step }));
  let emailSteps = 0;
  let emailRewrites = 0;
  let passwordSteps = 0;
  for (let index = 0; index < rewritten.length; index += 1) {
    const step = rewritten[index];
    const description = typeof step.description === "string" ? step.description : "";
    const input = typeof step.input === "string" ? step.input : "";
    if (input !== options.email && !description.includes(options.email)) continue;
    emailSteps += 1;
    if (options.newEmail && options.newEmail !== options.email) {
      if (input === options.email) step.input = options.newEmail;
      if (description.includes(options.email)) {
        step.description = description.split(options.email).join(options.newEmail);
      }
      emailRewrites += 1;
    }
    for (let offset = 1; offset <= 3 && index + offset < rewritten.length; offset += 1) {
      const candidate = rewritten[index + offset];
      const candidateDescription = typeof candidate.description === "string" ? candidate.description : "";
      if (!/password/i.test(candidateDescription)) continue;
      const oldPassword =
        (typeof candidate.input === "string" && candidate.input) || parseFill(candidateDescription)?.value || "";
      if (!oldPassword) break;
      if (typeof candidate.input === "string") candidate.input = options.newPassword;
      if (candidateDescription.includes(oldPassword)) {
        candidate.description = candidateDescription.split(oldPassword).join(options.newPassword);
      }
      passwordSteps += 1;
      break;
    }
  }
  return { steps: rewritten, emailSteps, emailRewrites, passwordSteps, changed: emailRewrites > 0 || passwordSteps > 0 };
}

interface Options {
  email: string;
  newEmail: string;
  base: string;
  project: string;
  testsprite: string;
  passwordFile: string;
  apply: boolean;
  skipDb: boolean;
  skipTestsprite: boolean;
  testIds: string[];
  backends: string[];
}

function parseArgs(argv: string[]): Options | null {
  const options: Options = {
    email: DEFAULT_EMAIL,
    newEmail: "",
    base: DEFAULT_BASE,
    project: DEFAULT_PROJECT,
    testsprite: DEFAULT_TESTSRITE,
    passwordFile: "",
    apply: false,
    skipDb: false,
    skipTestsprite: false,
    testIds: [],
    backends: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? "";
    if (arg === "--email") options.email = next();
    else if (arg === "--new-email") options.newEmail = next();
    else if (arg === "--base") options.base = next();
    else if (arg === "--project") options.project = next();
    else if (arg === "--testsprite") options.testsprite = next();
    else if (arg === "--password-file") options.passwordFile = next();
    else if (arg === "--test-ids") options.testIds = next().split(",").map((id) => id.trim()).filter(Boolean);
    else if (arg === "--backends") options.backends = next().split(",").map((id) => id.trim()).filter(Boolean);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--skip-db") options.skipDb = true;
    else if (arg === "--skip-testsprite") options.skipTestsprite = true;
    else return null;
  }
  return options.passwordFile ? options : null;
}

function runTestsprite(options: Options, args: string[]): string {
  return execFileSync(options.testsprite, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

interface TestListEntry {
  id: string;
  name?: string;
  type?: string;
}

async function rotateDatabase(options: Options, newPassword: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the DB half (use --skip-db on a box without it)");
  }
  const pg = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  try {
    const user = (await pg.query('select id from neon_auth."user" where email=$1', [options.email])).rows[0] as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`fixture user not found: ${options.email}`);
    if (!options.apply) {
      console.log("dry-run: would update the credential hash");
      return;
    }
    const previousRow = (
      await pg.query('select password from neon_auth."account" where "providerId"=$1 and "userId"=$2', [
        "credential",
        user.id,
      ])
    ).rows[0] as { password: string | null } | undefined;
    const previousHash = previousRow?.password ?? null;
    const restore = async (reason: string): Promise<never> => {
      if (previousHash) {
        await pg.query('update neon_auth."account" set password=$1 where "providerId"=$2 and "userId"=$3', [
          previousHash,
          "credential",
          user.id,
        ]);
        throw new Error(`sign-in verification failed (${reason}); the previous credential hash was restored`);
      }
      throw new Error(`sign-in verification failed (${reason}); the credential hash changed and could not be restored`);
    };
    const hash = bcrypt.hashSync(newPassword, 10);
    const updated = await pg.query(
      'update neon_auth."account" set password=$1, "updatedAt"=now() where "providerId"=$2 and "userId"=$3',
      [hash, "credential", user.id],
    );
    if (!updated.rowCount) throw new Error("no credential account row updated");
    console.log(`updated credential hash for ${options.email}`);
    try {
      const response = await fetch(`${options.base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: options.email, password: newPassword }),
      });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      await restore(String((error as Error).message).slice(0, 160));
    }
    console.log("sign-in verification passed");
  } finally {
    await pg.end();
  }
}

async function rotatePlans(options: Options, newPassword: string): Promise<void> {
  const list = JSON.parse(runTestsprite(options, ["test", "list", "--project", options.project, "--output", "json"])) as {
    items?: TestListEntry[];
  };
  const tests = (list.items ?? []).filter((test) => !options.testIds.length || options.testIds.includes(test.id));
  const summary = { scanned: 0, affected: 0, rewritten: 0, failures: [] as { id: string; error: string }[] };
  for (const test of tests) {
    if (test.type === "backend") continue;
    summary.scanned += 1;
    let detail: { planSteps?: FixturePlanStep[] };
    try {
      detail = JSON.parse(runTestsprite(options, ["test", "get", test.id, "--output", "json"]));
    } catch (error) {
      summary.failures.push({ id: test.id, error: `get failed: ${String((error as Error).message).slice(0, 120)}` });
      continue;
    }
    const steps = detail.planSteps ?? [];
    const outcome = rewritePlanSteps(steps, {
      email: options.email,
      newPassword,
      newEmail: options.newEmail || undefined,
    });
    if (!outcome.changed) continue;
    summary.affected += 1;
    if (!options.apply) {
      console.log(
        `would rewrite ${test.id} (${test.name ?? "unnamed"}) — ${outcome.emailRewrites} email / ${outcome.passwordSteps} password step(s)`,
      );
      continue;
    }
    const dir = mkdtempSync(join(tmpdir(), "rotate-e2e-fixture-"));
    try {
      const file = join(dir, "steps.json");
      writeFileSync(file, JSON.stringify({ planSteps: outcome.steps }));
      runTestsprite(options, [
        "test",
        "plan",
        "put",
        test.id,
        "--steps",
        file,
        "--expected-step-count",
        String(steps.length),
        "--output",
        "json",
      ]);
      summary.rewritten += 1;
      console.log(`rewrote ${test.id} (${test.name ?? "unnamed"})`);
    } catch (error) {
      summary.failures.push({ id: test.id, error: String((error as Error).message).slice(0, 200) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length) process.exitCode = 1;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(
      "usage: tsx scripts/rotate-e2e-fixture.mts --password-file <path> [--email <addr>] [--new-email <addr>] [--apply] [--skip-db] [--skip-testsprite] [--project <id>] [--test-ids <id,id>] [--backends <id,id>]",
    );
    process.exit(1);
  }
  const newPassword = readFileSync(options.passwordFile, "utf8").trim();
  if (!newPassword) throw new Error("password file is empty");
  if (!options.apply) console.log("dry-run: no changes will be written (pass --apply to rotate)");
  if (!options.skipDb) await rotateDatabase(options, newPassword);
  if (!options.skipTestsprite) await rotatePlans(options, newPassword);
  if (options.apply && options.backends.length) {
    for (const id of options.backends) {
      runTestsprite(options, [
        "project",
        "credential",
        id,
        "--type",
        "API key",
        "--credential-file",
        options.passwordFile,
        "--output",
        "json",
      ]);
      console.log(`refreshed backend credential on ${id}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
