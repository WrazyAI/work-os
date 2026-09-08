import { describe, expect, it } from "vitest";
import {
  annotationsForTarget,
  applyEditsToCommitments,
  countAnnotationsForCommitment,
  diffEditedCommitments,
  isAnnotationCommentValid,
  parseCriteriaLines,
  sanitizeComment,
  sanitizeQuote,
  type PlanAnnotation,
} from "./planningAnnotations";

const annotation = (target: string, quote = "friction points", comment = "Make this concrete"): PlanAnnotation => ({
  id: `a-${target}`, target, quote, comment,
});

describe("planning annotations", () => {
  it("collapses whitespace and caps quote and comment length", () => {
    expect(sanitizeQuote("  padded\n\ttext  ")).toBe("padded text");
    expect(sanitizeQuote("x".repeat(600))).toHaveLength(500);
    expect(sanitizeComment("ok".padEnd(1200, "!"))).toHaveLength(1000);
  });

  it("requires a meaningful comment before an annotation can be added", () => {
    expect(isAnnotationCommentValid("")).toBe(false);
    expect(isAnnotationCommentValid("ab")).toBe(false);
    expect(isAnnotationCommentValid("Make this concrete")).toBe(true);
  });

  it("scopes counts to one commitment and filters exact targets", () => {
    const list = [annotation("summary", "focus"), annotation("title:c1"), annotation("objective:c1"), annotation("title:c2")];
    expect(countAnnotationsForCommitment(list, "c1")).toBe(2);
    expect(countAnnotationsForCommitment(list, "c2")).toBe(1);
    expect(annotationsForTarget(list, "summary")).toHaveLength(1);
    expect(annotationsForTarget(list, "title:c1")).toHaveLength(1);
  });

  it("applies committed edits while preserving untouched fields", () => {
    const draft = [{ clientId: "c1", title: "Old", objective: "Do it", successCriteria: ["a"], confidence: 0.8 }];
    const next = applyEditsToCommitments(draft, { c1: { title: "New", objective: "Do it", successCriteria: ["a"] } });
    expect(next[0]?.title).toBe("New");
    expect(next[0]?.confidence).toBe(0.8);
    expect(applyEditsToCommitments(draft, {})).toEqual(draft);
  });

  it("diffs only genuinely changed fields for the refine payload", () => {
    const draft = [{ clientId: "c1", title: "Old", objective: "Do it", successCriteria: ["a", "b"] }];
    expect(diffEditedCommitments(draft, {})).toEqual([]);
    expect(diffEditedCommitments(draft, { c1: { title: "Old", objective: "Do it", successCriteria: ["a", "b"] } })).toEqual([]);
    expect(diffEditedCommitments(draft, { c1: { title: "New", objective: "Do it", successCriteria: ["a", "b"] } })).toEqual([{ clientId: "c1", title: "New" }]);
    expect(diffEditedCommitments(draft, { c1: { title: "Old", objective: "Do it", successCriteria: ["a"] } })).toEqual([{ clientId: "c1", successCriteria: ["a"] }]);
  });

  it("parses one criterion per line, dropping blanks", () => {
    expect(parseCriteriaLines("one\n\n  two  \n")).toEqual(["one", "two"]);
  });
});
