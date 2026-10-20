/**
 * Measures the real interpret prompt's cache behaviour: calls the shipped
 * function three times with the same task list and different employee input,
 * then reports the provider's cached prompt tokens from the usage line.
 */
import { interpretWorkUpdate } from "../src/lib/aiInterpret";

const TASK_COUNT = Number(process.env.TASK_COUNT ?? 264);
const tasks = Array.from({ length: TASK_COUNT }, (_, i) => ({
  id: `t-${i + 1}`,
  title: `Task ${i + 1}: ${["auth refactor", "billing webhook", "onboarding flow", "search index", "report export"][i % 5]} for client ${i % 17}`,
  completed: i % 7 === 0,
}));

const inputs = [
  "I finished the auth refactor and started on the billing webhook.",
  "The staging deploy keeps failing, I am blocked on access.",
  "Wrapped up the onboarding flow review this afternoon.",
];

console.log(`tasks: ${TASK_COUNT}`);
for (const [index, input] of inputs.entries()) {
  const started = Date.now();
  const result = await interpretWorkUpdate({ input, today: "2026-10-20" }, tasks);
  console.log(
    `call ${index + 1}: ok=${result.ok} model=${result.model ?? "-"} ${Date.now() - started}ms ` +
    `reply=${String(result.interpretation?.reply ?? "").slice(0, 70)}`,
  );
  // The provider caches asynchronously; give it a moment between turns like a
  // real conversation would.
  await new Promise((resolve) => setTimeout(resolve, 2500));
}
