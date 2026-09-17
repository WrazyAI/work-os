import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "./cx";

/** Copies text to the system clipboard, preferring the async clipboard API and
 * falling back to a hidden textarea for webviews that block it. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Hover-revealed copy control for one chat bubble or receipt. It stays out of
 * the layout flow (the row reserves its strip), so revealing it never shifts
 * the thread, and it reports success in place for a beat. */
export function CopyMessageButton({ text, className, label = "Copy message" }: { text: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    if (!(await writeClipboard(text))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      className={cx("chat-copy", copied && "is-copied", className)}
      aria-label={copied ? "Copied to clipboard" : label}
      title={copied ? "Copied" : "Copy"}
      onClick={() => void copy()}
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
