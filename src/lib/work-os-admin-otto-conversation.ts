/**
 * Deterministic conversational preflight for Admin Otto.
 *
 * Greetings, thanks, capability/self-identity questions and clean person
 * identity questions are answered from server-owned text before any model
 * call. The matcher only classifies the administrator's words; it never selects
 * a mutation, a tool, a URL, an employee-chat path or a provider. Identity
 * questions produce a name for the existing authorized directory resolver and
 * nothing else. Qualified overviews that cannot be reduced to a clean name
 * (time windows, self references, extra instructions) are deliberately left to
 * the normal typed parser rather than becoming a false missing-person card.
 */

export type AdminOttoConversationMatch =
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "capability"; followUp: boolean }
  | { kind: "self" }
  | { kind: "identity"; name: string };

export type AdminOttoConversationalMatch = Exclude<AdminOttoConversationMatch, { kind: "identity" }>;

export type AdminOttoMessageRef = { v: 1; kind: "message"; text: string };

const MAX_INPUT = 4_000;
const MAX_NAME_LENGTH = 120;
/** Conversational replies are short. The stored ref is the only copy of a
 * message-only turn, so keep it bounded and reject anything larger on read. */
const MAX_MESSAGE_LENGTH = 2_000;

const MESSAGE_KEYS = ["v", "kind", "text"] as const;

const GREETING = /^(?:hi|hello|hey|howdy|yo|good\s+(?:morning|afternoon|evening)|morning|afternoon|evening)(?:[,\s]+(?:there|otto|admin\s+otto)){0,2}$/u;
const THANKS = /^(?:thanks|thank\s+you|thx|ty)(?:[,\s]+(?:a\s+lot|so\s+much|very\s+much|again))?(?:[,\s]+(?:otto|admin\s+otto))?$/u;
const CAPABILITY_MORE = /^(?:what\s+else(?:\s+can\s+you\s+do|\s+can\s+i\s+ask|\s+is\s+there)?|anything\s+else|more\s+examples?)$/u;
const CAPABILITY = /^(?:help|what\s+can\s+you\s+do|what\s+do\s+you\s+do|what\s+can\s+i\s+ask(?:\s+you)?|what\s+are\s+(?:your\s+)?capabilities|what\s+are\s+you\s+able\s+to\s+do|how\s+does\s+(?:this|it)\s+work(?:\s+then)?|how\s+do\s+you\s+work)$/u;
/** Assistant identity, not an employee name. */
const SELF = /^(?:tell\s+me\s+(?:(?:anything|something|more|a\s+bit|a\s+little)\s+)?about\s+(?:yourself|you)|who\s+are\s+you|what\s+are\s+you)$/u;

/** Benign leading filler that does not narrow or change the directory query. */
const LEADING_ABOUT = /^(?:(?:anything|something|more|a\s+bit|a\s+little)\s+about|about)\s+/iu;
/** Benign request suffixes; they address the assistant, not the employee. */
const TRAILING_REQUEST = /(?:[,\s]+(?:please|for\s+me))+$/iu;
/** Words that make an overview qualified rather than a clean identity name.
 * They must never be persisted as part of an employee name. */
const QUALIFIER_WORD = /\b(?:anything|something|about|please|today|yesterday|tomorrow|tonight|now|lately|recently|so\s+far|this\s+week|last\s+week|this\s+month|last\s+month)\b/iu;
/** Self references are assistant/capability subjects, never employee names. */
const SELF_WORD = /\b(?:yourself|myself|ourselves|me|you|us)\b/iu;

/** A polite lead-in is still the same request: "Sure, what else can you do?". */
const LEAD_IN = /^(?:sure|ok|okay|yes|yeah|yep|cool|great|alright|all right|got it|sounds good|please)[,\s]+/iu;

const IDENTITY_PATTERNS = [
  /^do\s+you\s+know\s+who\s+(.+?)\s+is$/iu,
  /^do\s+you\s+know\s+(.+)$/iu,
  /^who\s+is\s+(.+)$/iu,
  /^who's\s+(.+)$/iu,
  /^tell\s+me\s+(?:(?:anything|something|more|a\s+bit|a\s+little)\s+)?about\s+(.+)$/iu,
  /^what\s+do\s+you\s+know\s+about\s+(.+)$/iu,
  /^what\s+can\s+you\s+tell\s+me\s+about\s+(.+)$/iu,
];

/** Words that make a captured phrase a subject, role or another operation
 * rather than a person the directory can resolve. */
const NON_PERSON = /\b(?:team|everyone|everybody|all|employees?|people|person|someone|anyone|staff|organization|company|manager|admin|administrator|owner|boss|me|you|us|them|they|he|she|him|her)\b/iu;
/** A compound question is not a single person's name; leave it to the typed
 * parser instead of treating the whole remainder as an unresolved employee. */
const COMPOUND = /\b(?:and|what|who|whom|whose|which|when|where|why|how|did|does|do|is|are|was|were)\b/iu;
const UNSAFE_NAME = /\b(?:send|message|email|reply|notify|delete|remove|archive|create|update|assign|approve|reject|comment|task|tasks|project|projects|account|password|login|sql|query|record|records|workday|recap|recaps|work|works|working|report|reports|eod)\b/iu;
const POSSESSIVE = /'s\b/iu;
/** Letters, marks, spaces, apostrophes, periods and hyphens only. No ids,
 * separators, digits or punctuation that could smuggle a second request. */
const PERSON_NAME = /^[\p{L}\p{M}](?:[\p{L}\p{M}\s'.-]*[\p{L}\p{M}.])?$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function phrase(value: string): string {
  let current = value
    .normalize("NFC")
    .replace(/[\u2018\u2019\u201b`\u00b4]/g, "'")
    .replace(/\s+/gu, " ")
    .trim();
  for (let index = 0; index < 3; index += 1) {
    const next = current.replace(LEAD_IN, "").trim();
    if (next === current) break;
    current = next;
  }
  return trimPunctuation(current);
}

function trimPunctuation(value: string): string {
  return value.replace(/^[\s"'`]+|[\s.!?,;:"'`]+$/gu, "").trim();
}

function cleanName(value: string): string | null {
  let name = value.replace(/\s+/g, " ").trim();
  for (let index = 0; index < 2; index += 1) {
    const next = name.replace(LEADING_ABOUT, "").trim();
    if (next === name) break;
    name = next;
  }
  for (let index = 0; index < 2; index += 1) {
    const next = name.replace(TRAILING_REQUEST, "").trim();
    if (next === name) break;
    name = next;
  }
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  if (name.normalize("NFC") !== name) return null;
  if (UUID.test(name)) return null;
  // A qualified overview or a self reference is not an employee name. Return
  // null so executeAdminOttoChat delegates to the normal typed parser instead
  // of resolving a literal phrase such as "David today" as missing.
  if (QUALIFIER_WORD.test(name) || SELF_WORD.test(name)) return null;
  if (!PERSON_NAME.test(name)) return null;
  if (NON_PERSON.test(name) || COMPOUND.test(name) || UNSAFE_NAME.test(name) || POSSESSIVE.test(name)) return null;
  return name;
}

function identityName(value: string): string | null {
  for (const pattern of IDENTITY_PATTERNS) {
    const match = pattern.exec(value);
    if (match) return cleanName(match[1]);
  }
  return null;
}

/** Classify one bounded conversational phrase. Anything ambiguous or carrying
 * extra instructions returns null so the normal read-intent parser owns it. */
export function matchAdminOttoConversation(text: unknown): AdminOttoConversationMatch | null {
  if (typeof text !== "string") return null;
  const source = text.trim();
  if (!source || source.length > MAX_INPUT || /[\r\n]/.test(source)) return null;
  const value = phrase(source);
  if (!value) return null;
  const lower = value.toLowerCase();
  if (GREETING.test(lower)) return { kind: "greeting" };
  if (THANKS.test(lower)) return { kind: "thanks" };
  if (CAPABILITY_MORE.test(lower)) return { kind: "capability", followUp: true };
  if (CAPABILITY.test(lower)) return { kind: "capability", followUp: false };
  if (SELF.test(lower)) return { kind: "self" };
  const name = identityName(value);
  return name ? { kind: "identity", name } : null;
}

const GREETING_REPLIES = [
  "Hi! I can read Work OS records: unfinished or overdue tasks, work updates and EOD text, reviewed recaps, and workdays. For example, \"Show Alex's unfinished tasks\" or \"What did David report yesterday?\"",
  "Hello! I'm read-only here. Ask me for open tasks, recent work records, reviewed recaps, or a workday snapshot — for one person or the team. Try \"Show unfinished tasks across the team.\"",
  "Hey — I can look up existing Work OS records for you. For instance, \"Read Maria's latest reviewed recap\" or \"Show Alex's workday record for Oct 20.\"",
] as const;

const THANKS_REPLIES = [
  "You're welcome. Ask for another read whenever you need one.",
  "Happy to help. I can keep looking up tasks, records, recaps, or workdays.",
  "Anytime. If you want another read, name someone or say \"the team.\"",
] as const;

const SELF_REPLIES = [
  "I'm Admin Otto, a read-only assistant for Work OS. I can look up unfinished or overdue tasks, work records, reviewed recaps, and workdays — for example, \"Show Alex's unfinished tasks.\" I can't change, message, approve, or run anything.",
  "I'm Otto, the read-only administration assistant. I answer from existing Work OS records: tasks, updates and EOD text, reviewed recaps, and workdays. Try \"What did David report yesterday?\"",
  "I'm Admin Otto. I only read existing Work OS records — open tasks, work records, reviewed recaps, and workdays. Ask about a person or the team, and I'll show what's already on file.",
] as const;

const CAPABILITY_REPLIES = [
  "I can read five things here: unfinished or overdue tasks, work records such as updates and EOD text, reviewed recaps, a latest reviewed recap, and workday snapshots. For example, \"Show Alex's unfinished tasks\" or \"What did David report yesterday?\"",
  "I'm a read-only admin assistant. I can list open or overdue tasks, pull work records for a date or local range, show reviewed recaps, read the latest reviewed recap, and check a workday. Try \"Show unfinished tasks across the team.\"",
  "Ask me about existing records: open tasks, updates and EOD text, reviewed recaps, or workdays, for one person or the whole team. Example: \"What did Maria report today?\"",
] as const;

const CAPABILITY_FOLLOW_UP_REPLIES = [
  "I can list unfinished or overdue tasks, pull work records, show reviewed recaps, and read a workday. More examples: \"Show the team's overdue tasks\" or \"Show Alex's workday record for Oct 20.\" Limits: read-only, active employees in your organization only, person overviews cover the last 7 days, and explicit ranges cap at 31 days. I can't edit, message, approve, or run anything.",
  "On top of tasks and work records, I can filter by today or yesterday, show the latest reviewed recap per employee, and read a workday snapshot. Limits: the default recent window is 7 days, an explicit range caps at 31 days, and I only see active employees in this organization. Nothing I show can be changed from here.",
  "A few limits: I don't show private chats, drafts, memory, or screenshots. I only read existing tasks, records, recaps, and workdays — no task edits, messages, approvals, SQL, or tools. Name a person, the team, or a date range and I'll read it.",
] as const;

function variant(replies: readonly string[], turnNumber: number): string {
  const index = ((Math.trunc(turnNumber) % replies.length) + replies.length) % replies.length;
  return replies[index] ?? replies[0];
}

/** A bounded reply for a greeting, thanks or capability question. The turn
 * number rotates the wording so the next turn never repeats it verbatim. */
export function adminOttoConversationReply(match: AdminOttoConversationalMatch, turnNumber: number): string {
  if (match.kind === "greeting") return variant(GREETING_REPLIES, turnNumber);
  if (match.kind === "thanks") return variant(THANKS_REPLIES, turnNumber);
  if (match.kind === "self") return variant(SELF_REPLIES, turnNumber);
  return match.followUp
    ? variant(CAPABILITY_FOLLOW_UP_REPLIES, turnNumber)
    : variant(CAPABILITY_REPLIES, turnNumber);
}

/** Build the persisted opaque ref for a message-only turn. */
export function adminOttoMessageRef(text: string): AdminOttoMessageRef {
  const value = text.trim();
  if (!value || value.length > MAX_MESSAGE_LENGTH) {
    throw new Error("Admin Otto conversational reply is outside the stored-message bound");
  }
  return { v: 1, kind: "message", text: value };
}

/** Rehydrate a stored message ref. Unknown versions/kinds, extra fields and
 * oversized text are refused rather than trusted. */
export function readAdminOttoMessageRef(value: unknown): AdminOttoMessageRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== MESSAGE_KEYS.length || !MESSAGE_KEYS.every((key) => key in row)) return null;
  if (row.v !== 1 || row.kind !== "message") return null;
  if (typeof row.text !== "string") return null;
  const text = row.text.trim();
  if (!text || text !== row.text || text.length > MAX_MESSAGE_LENGTH) return null;
  return { v: 1, kind: "message", text };
}
