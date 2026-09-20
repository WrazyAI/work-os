import { cx } from "./cx";

export type ChatWelcomeMode = "update" | "agenda";

type WelcomeVariant = {
  namedTitle: (firstName: string) => string;
  anonymousTitle: string;
  body: string;
};

const UPDATE_VARIANTS: WelcomeVariant[] = [
  {
    namedTitle: (firstName) => `Got an update, ${firstName}?`,
    anonymousTitle: "Got an update?",
    body: "Share what changed, what you finished, or where you are blocked.",
  },
  {
    namedTitle: (firstName) => `What moved today, ${firstName}?`,
    anonymousTitle: "What moved today?",
    body: "A quick note is enough. I will help turn it into a clear record.",
  },
  {
    namedTitle: (firstName) => `Ready to capture progress, ${firstName}?`,
    anonymousTitle: "Ready to capture progress?",
    body: "Tell me about a win, a blocker, a priority shift, or a new task.",
  },
];

const AGENDA_VARIANTS: WelcomeVariant[] = [
  {
    namedTitle: (firstName) => `What are you moving today, ${firstName}?`,
    anonymousTitle: "What are you moving today?",
    body: "Set the context for your day. Planning here does not clock you in.",
  },
  {
    namedTitle: (firstName) => `Ready to shape today's focus, ${firstName}?`,
    anonymousTitle: "Ready to shape today's focus?",
    body: "Start with the work that matters most.",
  },
  {
    namedTitle: (firstName) => `What should lead the day, ${firstName}?`,
    anonymousTitle: "What should lead the day?",
    body: "Add a little context before you get moving.",
  },
];

export function firstNameFromDisplayName(displayName?: string | null): string | null {
  const trimmed = displayName?.trim();
  return trimmed ? trimmed.split(/\s+/)[0] ?? null : null;
}

function stableIndex(seed: string, length: number): number {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

export function getChatWelcomeCopy({ displayName, mode = "update", seed = "default" }: {
  displayName?: string | null;
  mode?: ChatWelcomeMode;
  seed?: string;
}): { title: string; body: string } {
  const variants = mode === "agenda" ? AGENDA_VARIANTS : UPDATE_VARIANTS;
  const variant = variants[stableIndex(`${mode}:${seed}`, variants.length)]!;
  const firstName = firstNameFromDisplayName(displayName);
  return {
    title: firstName ? variant.namedTitle(firstName) : variant.anonymousTitle,
    body: variant.body,
  };
}

/** The empty thread is intentionally text-only; agent identity appears once the
 * conversation has a real assistant turn, not as a decorative hero mark. */
export function ChatWelcome({ displayName, mode = "update", seed = "default" }: {
  displayName?: string | null;
  mode?: ChatWelcomeMode;
  seed?: string;
}) {
  const copy = getChatWelcomeCopy({ displayName, mode, seed });
  return (
    <div className={cx("chat-welcome", "chat-welcome-hero", mode === "agenda" && "agenda-welcome")}>
      <div className="chat-welcome-content">
        <span className="chat-welcome-kicker">{mode === "agenda" ? "Today's focus" : "Workday note"}</span>
        <strong>{copy.title}</strong>
        <p>{copy.body}</p>
      </div>
    </div>
  );
}
