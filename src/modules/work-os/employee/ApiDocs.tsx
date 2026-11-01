"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import {
  AGENT_API_BASE_URL,
  AGENT_API_CURL_SAMPLE,
  AGENT_API_ENDPOINTS,
  AGENT_API_ERRORS,
  AGENT_API_EVIDENCE_MAX_BYTES,
  AGENT_API_EVIDENCE_TYPE_LABELS,
  AGENT_API_MCP_TOOLS,
  AGENT_API_MCP_URL,
  AGENT_API_OPENAPI_URL,
  AGENT_API_RATE_LIMIT_REQUESTS,
  AGENT_API_RATE_LIMIT_WRITES,
  AGENT_API_SCOPES,
  AGENT_API_SECTIONS,
  AGENT_API_TYPESCRIPT_SAMPLE,
  type AgentApiEndpoint,
} from "@/modules/work-os/agent-api-docs";
import { Masthead, Panel, StatusPill } from "./ui";
import styles from "./ApiDocs.module.css";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const statusId = useId();

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  return (
    <span className={styles.copy}>
      <button type="button" className={styles.copyButton} onClick={() => void copy()} aria-describedby={statusId} aria-label={`Copy ${label}`}>
        {state === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy"}
      </button>
      <span id={statusId} role="status" aria-live="polite" className={styles.srOnly}>
        {state === "copied" ? `${label} copied to the clipboard.` : state === "error" ? `Could not copy ${label}. Select the text and copy it manually.` : ""}
      </span>
    </span>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{label}</span>
        <CopyButton text={code} label={label} />
      </div>
      <pre tabIndex={0} aria-label={`${label} example`}><code>{code}</code></pre>
    </div>
  );
}

function SectionHeading({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className={styles.sectionHeading}>
      <h2 id={id}>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

function Method({ method }: { method: AgentApiEndpoint["method"] }) {
  return <span className={styles.method} data-method={method}>{method}</span>;
}

function EndpointRow({ endpoint }: { endpoint: AgentApiEndpoint }) {
  return (
    <li className={styles.endpoint} data-endpoint-method={endpoint.method} data-endpoint-path={endpoint.path}>
      <div className={styles.endpointSignature}>
        <Method method={endpoint.method} />
        <code>{endpoint.path}</code>
      </div>
      <div className={styles.endpointPurpose}>
        <p>{endpoint.purpose}</p>
        {endpoint.note ? <span>{endpoint.note}</span> : null}
      </div>
      <span className={styles.scope}>{endpoint.scopeLabel}</span>
    </li>
  );
}

export default function ApiDocs() {
  const readEndpoints = AGENT_API_ENDPOINTS.filter((endpoint) => endpoint.group === "read");
  const writeEndpoints = AGENT_API_ENDPOINTS.filter((endpoint) => endpoint.group === "write");
  const schemaEndpoints = AGENT_API_ENDPOINTS.filter((endpoint) => endpoint.group === "schema");

  return (
    <div className={styles.docs} data-api-docs>
      <Masthead
        eyebrow="Work OS"
        title="Agent API"
        meta="Version 1. Scoped REST and MCP access for one person's work."
        actions={
          <a className={styles.actionLink} href={AGENT_API_OPENAPI_URL} target="_blank" rel="noreferrer">
            Open API schema <ExternalLink size={13} aria-hidden />
          </a>
        }
      />

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={styles.hero} aria-labelledby="api-overview">
            <div className={styles.heroCopy}>
              <p className={styles.lede} id="api-overview">
                The Agent API reads and updates the work assigned to one person from a scoped REST surface. Use it to create tasks, record progress, attach completion evidence, replay changes, and run core task operations through MCP.
              </p>
              <div className={styles.baseUrl}>
                <span>Base URL</span>
                <code>{AGENT_API_BASE_URL}</code>
                <CopyButton text={AGENT_API_BASE_URL} label="API base URL" />
              </div>
            </div>

            <div className={styles.access} aria-labelledby="access-title">
              <p className={styles.accessKicker}>Access boundary</p>
              <h2 id="access-title">One token. One person.</h2>
              <div className={styles.accessMap}>
                <div className={styles.accessNode}>
                  <KeyRound size={17} aria-hidden />
                  <span>Bearer token</span>
                  <code>wos_agent_…</code>
                  <small>Scopes apply to this token</small>
                </div>
                <div className={styles.accessConnector} aria-hidden="true"><span>resolves to</span></div>
                <div className={`${styles.accessNode} ${styles.personNode}`}>
                  <LockKeyhole size={17} aria-hidden />
                  <span>Person scope</span>
                  <strong>Their assigned work</strong>
                  <small>Tasks, progress, and evidence</small>
                </div>
              </div>
              <p className={styles.accessNote}>Other people and workspaces stay outside this boundary. A cross-person or deleted task id returns 404.</p>
            </div>
          </section>

          <Panel className={styles.guide}>
            <section id="get-token" className={styles.section} aria-labelledby="get-token-title">
              <SectionHeading id="get-token-title" title="Get a token">
                A token is created for you and acts only as you. Nobody can mint a token that acts as another person.
              </SectionHeading>
              <ol className={styles.steps}>
                <li>
                  <span className={styles.stepNumber}>1</span>
                  <div><h3>Open Settings → Agent access.</h3><p>The token panel is personal to your account. It lists only tokens you created.</p></div>
                </li>
                <li>
                  <span className={styles.stepNumber}>2</span>
                  <div><h3>Name the token and choose an expiry.</h3><p>The default is 90 days; the maximum is 365. The name is for recognising the integration later.</p></div>
                </li>
                <li>
                  <span className={styles.stepNumber}>3</span>
                  <div><h3>Select the scopes you need.</h3><p>Scopes are chosen at creation and cannot be edited later. Read and write scopes are independent.</p></div>
                </li>
                <li>
                  <span className={styles.stepNumber}>4</span>
                  <div><h3>Copy the secret now.</h3><p>It is shown once and stored only as a SHA-256 hash. Revoke it from the same panel when the integration is finished.</p></div>
                </li>
              </ol>
              <div className={styles.inlineAction}>
                <Link href="/work-os/settings#agent-access" className={styles.primaryLink}><KeyRound size={14} aria-hidden /> Open Agent access</Link>
                <span>The panel is under Settings, beside your profile and workday.</span>
              </div>
            </section>

            <section id="first-call" className={styles.section} aria-labelledby="first-call-title">
              <SectionHeading id="first-call-title" title="First call">
                Call <code>/me</code> before anything else. It proves the token and shows the exact workspace and person scope.
              </SectionHeading>
              <div className={styles.codeStack}>
                <CodeBlock label="curl" code={AGENT_API_CURL_SAMPLE} />
                <CodeBlock label="TypeScript" code={AGENT_API_TYPESCRIPT_SAMPLE} />
              </div>
              <p className={styles.helper}>Run the TypeScript example with <code>npx tsx me.ts</code> after setting <code>WORK_OS_API_TOKEN</code>. The curl example uses <code>--fail-with-body</code>, so a rejected token exits nonzero and still prints the API error.</p>
            </section>

            <section id="endpoints" className={styles.section} aria-labelledby="endpoints-title">
              <SectionHeading id="endpoints-title" title="Endpoints">
                Paths are relative to the API base. Every write requires <code>Idempotency-Key</code>; reads do not.
              </SectionHeading>
              <div className={styles.endpointGroups}>
                <div>
                  <h3 className={styles.groupTitle}>Read path</h3>
                  <ul className={styles.endpointList}>{readEndpoints.map((endpoint) => <EndpointRow key={`${endpoint.method} ${endpoint.path}`} endpoint={endpoint} />)}</ul>
                </div>
                <div>
                  <h3 className={styles.groupTitle}>Write path</h3>
                  <ul className={styles.endpointList}>{writeEndpoints.map((endpoint) => <EndpointRow key={`${endpoint.method} ${endpoint.path}`} endpoint={endpoint} />)}</ul>
                </div>
                <div>
                  <h3 className={styles.groupTitle}>Contract</h3>
                  <ul className={styles.endpointList}>{schemaEndpoints.map((endpoint) => <EndpointRow key={`${endpoint.method} ${endpoint.path}`} endpoint={endpoint} />)}</ul>
                </div>
              </div>
              <p className={styles.helper}>Batch checks each operation&apos;s scope: task operations use <code>tasks:write</code>, and <code>log_progress</code> uses <code>progress:write</code>. The request itself has no additional scope gate.</p>
            </section>

            <section id="scopes" className={styles.section} aria-labelledby="scopes-title">
              <SectionHeading id="scopes-title" title="Scopes">
                Select the smallest set that completes the job. A scope never implies another scope.
              </SectionHeading>
              <div className={styles.scopeList}>
                {AGENT_API_SCOPES.map((scope) => (
                  <div key={scope.id} className={styles.scopeRow}>
                    <code>{scope.id}</code>
                    <div><strong>{scope.label}</strong><p>{scope.grants}</p><span>{scope.limit}</span></div>
                  </div>
                ))}
              </div>
              <div className={styles.note}>
                <ShieldCheck size={16} aria-hidden />
                <p>A read-only token connects normally. Writes come back as <code>403 insufficient_scope</code> over REST, or as a tool result with <code>isError: true</code> and <code>code: &quot;insufficient_scope&quot;</code> over MCP. The connection stays open.</p>
              </div>
            </section>

            <section id="limits" className={styles.section} aria-labelledby="limits-title">
              <SectionHeading id="limits-title" title="Limits and evidence">
                These are the rules that keep retries safe and completion claims honest.
              </SectionHeading>
              <div className={styles.rules}>
                <div className={styles.rule}>
                  <h3>Every write needs an idempotency key.</h3>
                  <p>Send <code>Idempotency-Key</code> with 1–160 characters. The response is cached for 24 hours. Repeating the same key and body replays the stored response with <code>Idempotent-Replay: true</code>.</p>
                  <p>Reusing the key with a different body returns <code>409 idempotency_conflict</code>. If the first request is still applying, the response is <code>409 idempotency_in_flight</code> with <code>Retry-After: 1</code>. A retried create also reconciles at the row level, so a lost response returns the same task.</p>
                </div>
                <div className={styles.rule}>
                  <h3>The rate limit is per token.</h3>
                  <p>{AGENT_API_RATE_LIMIT_REQUESTS} requests and {AGENT_API_RATE_LIMIT_WRITES} writes per minute. A batch counts as one request and one write. Over the limit returns <code>429 rate_limited</code> with <code>Retry-After</code>.</p>
                </div>
                <div className={styles.rule}>
                  <h3>Evidence is one file, up to {AGENT_API_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB.</h3>
                  <p>REST accepts multipart <code>file</code>, an optional <code>note</code> up to 1,000 characters, and <code>complete</code>. REST defaults <code>complete</code> to true; MCP defaults it to false. Accepted files are {AGENT_API_EVIDENCE_TYPE_LABELS.join(", ")}. MCP sends the same file as padded base64.</p>
                  <p>A task with an <code>expected_outcome</code> or <code>definition_of_done</code> answers <code>409 evidence_required</code> until a file is attached. If attachment succeeds but completion fails, the <code>502</code> carries the saved evidence; retry the completion with the same key.</p>
                </div>
              </div>
              <CodeBlock
                label="Attach evidence"
                code={`curl --fail-with-body -X POST \\
  -H "Authorization: Bearer $WORK_OS_API_TOKEN" \\
  -H "Idempotency-Key: evidence-1" \\
  -F "file=@release-check.png" \\
  -F "note=Signed build verified" \\
  -F "complete=true" \\
  "https://app.wrazyos.com/api/agent/v1/tasks/$TASK_ID/evidence"`}
              />
            </section>

            <section id="behavior" className={styles.section} aria-labelledby="behavior-title">
              <SectionHeading id="behavior-title" title="Agent behavior">
                The token preserves the employee record&apos;s existing boundaries.
              </SectionHeading>
              <div className={styles.behaviorList}>
                <div><h3>Assignment is self-only.</h3><p>A created task defaults to the token&apos;s own person. An explicit assignee list may name only that person; a coworker id returns <code>400 validation_error</code>. An empty list creates unassigned work, which leaves the assignee-scoped list but remains readable by id because the token&apos;s person becomes its assigner. Hand work to a coworker from the employee workspace.</p></div>
                <div><h3>A hidden task is a 404.</h3><p>Work outside the token&apos;s person, and work that was deleted, answers <code>404 not_found</code>. Work OS does not reveal whether another person owns an id.</p></div>
                <div><h3>Completion closes open subtasks.</h3><p>Completing a parent completes its open subtasks first. If a subtask cannot close, the parent stays open. Reopening a task does not reopen its subtasks.</p></div>
                <div><h3>Content changes need edit control.</h3><p>Name, dates, description, labels, outcomes, estimates, and board group require edit control. The assignee can record or clear a blocker without edit control. A person who neither holds nor manages the task receives <code>403 forbidden</code>.</p></div>
              </div>
            </section>

            <section id="errors" className={styles.section} aria-labelledby="errors-title">
              <SectionHeading id="errors-title" title="Errors">
                Every failed REST request returns an error, a stable code, and a request id. Use the code for recovery; include the request id when reporting a 5xx.
              </SectionHeading>
              <div className={styles.errorEnvelope}>
                <span>Error envelope</span>
                <code>{`{ "error": "Task not found", "code": "not_found", "request_id": "…" }`}</code>
              </div>
              <table className={styles.errorTable}>
                <caption className={styles.srOnly}>Agent API error codes, HTTP status, and recovery action</caption>
                <thead><tr><th scope="col">Code</th><th scope="col">Status</th><th scope="col">What to do</th></tr></thead>
                <tbody>
                  {AGENT_API_ERRORS.map((error) => (
                    <tr key={error.code}>
                      <th scope="row" data-label="Code"><code>{error.code}</code></th>
                      <td data-label="Status"><span className={styles.status}><span aria-hidden className={error.status >= 500 ? styles.statusError : styles.statusWarn} />{error.status}</span></td>
                      <td data-label="What to do">{error.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={styles.notFoundNote}><AlertTriangle size={15} aria-hidden /> Cross-person and removed work is <code>404</code>, never <code>403</code>. A <code>403</code> means the token&apos;s person has a permission or scope boundary on work they can see.</p>
            </section>

            <section id="mcp" className={styles.section} aria-labelledby="mcp-title">
              <SectionHeading id="mcp-title" title="MCP">
                The MCP endpoint uses the same token, scopes, person, evidence gate, rate limits, and provenance as REST. It is one connection path, not a second credential.
              </SectionHeading>
              <div className={styles.mcpHeader}>
                <div><Bot size={17} aria-hidden /><code>{AGENT_API_MCP_URL}</code></div>
                <StatusPill tone="info">POST only</StatusPill>
                <CopyButton text={AGENT_API_MCP_URL} label="MCP endpoint" />
              </div>
              <p className={styles.helper}>Stateless Streamable HTTP with JSON responses. Send <code>Accept: application/json, text/event-stream</code> and <code>Content-Type: application/json</code>. <code>GET</code> and <code>DELETE</code> return <code>405</code>. Tool failures arrive as <code>isError: true</code> results with the same error codes; the connection stays open. A revoked or expired token still fails the connection with <code>401</code>.</p>
              <div className={styles.mcpTools}>
                {AGENT_API_MCP_TOOLS.map((tool) => <div key={tool.name}><code>{tool.name}</code><span>{tool.scope}</span><p>{tool.behavior}</p></div>)}
              </div>
              <div className={styles.mcpFooter}>
                <p>Write tools accept an optional <code>idempotency_key</code>. When omitted, the server derives a stable key from the tool and its arguments.</p>
                <a href={AGENT_API_OPENAPI_URL} target="_blank" rel="noreferrer" className={styles.textLink}>Open the REST schema <ExternalLink size={13} aria-hidden /></a>
              </div>
            </section>
          </Panel>
        </div>

        <nav className={styles.toc} aria-label="On this page">
          <p>On this page</p>
          {AGENT_API_SECTIONS.map((section) => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
          <span className={styles.tocRule} />
          <a href={AGENT_API_OPENAPI_URL} target="_blank" rel="noreferrer">OpenAPI schema <ExternalLink size={12} aria-hidden /></a>
        </nav>
      </div>
    </div>
  );
}
