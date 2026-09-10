import assert from "node:assert/strict";
import { test } from "node:test";
import { formatEodAnnotations, sanitizeEodAnnotations } from "../src/lib/aiEod";

test("EOD annotations are bounded, cleaned, and structured for the prompt", () => {
  assert.deepEqual(sanitizeEodAnnotations(null), []);
  assert.deepEqual(sanitizeEodAnnotations([null, "x", { quote: "", comment: "ok" }, { quote: "text", comment: "ab" }]), []);
  assert.deepEqual(
    sanitizeEodAnnotations([
      { quote: "  the   release summary ", comment: "  make this shorter " },
      { quote: "client handoff", comment: "mention the owner and date" },
    ]),
    [
      { quote: "the release summary", comment: "make this shorter" },
      { quote: "client handoff", comment: "mention the owner and date" },
    ],
  );
  const capped = sanitizeEodAnnotations(Array.from({ length: 20 }, (_, index) => ({ quote: `q${index}`, comment: `comment ${index}` })));
  assert.equal(capped.length, 12);
  assert.equal(
    formatEodAnnotations([{ quote: "the release summary", comment: "make this shorter" }]),
    '- On "the release summary": make this shorter',
  );
});
