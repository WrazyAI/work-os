import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";

/** One small, deterministic highlighter for the public guide. */
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("typescript", typescript);

export type CodeLanguage = "bash" | "json" | "typescript";

export function highlightCode(code: string, language: CodeLanguage): string {
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
