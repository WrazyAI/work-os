import type { ReactNode } from "react";
import Link from "next/link";
import {
  ADMIN_AGENT_API_AGENT_PROMPT,
  ADMIN_AGENT_API_BASE_URL,
  ADMIN_AGENT_API_LLMS_PATH,
  ADMIN_AGENT_API_MCP_URL,
  ADMIN_AGENT_API_OPENAPI_URL,
} from "../agent-api-docs";
import {
  ADMIN_AGENT_API_AUTH,
  ADMIN_AGENT_API_ENDPOINTS,
  ADMIN_AGENT_API_ERROR_ENVELOPE,
  ADMIN_AGENT_API_ERRORS,
  ADMIN_AGENT_API_FIRST_CALL,
  ADMIN_AGENT_API_GROUPS,
  ADMIN_AGENT_API_MCP_RULE,
  ADMIN_AGENT_API_MCP_TOOLS,
  ADMIN_AGENT_API_RULES,
  ADMIN_AGENT_API_SCOPES,
  ADMIN_AGENT_API_TOKEN_STEPS,
  adminEndpointScopeLabel,
} from "../admin-agent-api-docs";
import shared from "../employee/ApiDocs.module.css";
import styles from "./AdminApiDocs.module.css";

const sections = [
  ["get-token", "Get a token"],
  ["scopes", "Scopes"],
  ["preview-and-limits", "Preview, confirm, and limits"],
  ["endpoints", "REST endpoints"],
  ["errors", "REST errors"],
  ["mcp", "MCP"],
] as const;

function Section({ section, children }: { section: (typeof sections)[number]; children: ReactNode }) {
  const [id, title] = section;
  return (
    <section id={id} className={shared.section} aria-labelledby={`${id}-title`}>
      <div className={shared.sectionHeading}><h2 id={`${id}-title`}>{title}</h2></div>
      {children}
    </section>
  );
}

export default function AdminApiDocs() {
  return (
    <article className={styles.adminDocs} data-admin-api-docs>
      <div className={shared.layout}>
        <div className={shared.mainColumn}>
          <div className={`${shared.hero} ${styles.hero}`}>
            <div className={shared.heroCopy}>
              <h1>Administrator Agent API</h1>
              <p className={shared.lede}>Read across your organization. Preview consequential changes before you approve them.</p>
              <div className={shared.baseUrl}><span>REST base</span><code>{ADMIN_AGENT_API_BASE_URL}</code></div>
            </div>
            <figure className={`${shared.access} ${styles.boundary}`}>
              <figcaption>
                <strong>One organization</strong>
                <span>The token acts as the administrator who created it.</span>
              </figcaption>
              <ol>
                <li><strong>Preview</strong><span>See changes and warnings. The record stays unchanged.</span></li>
                <li><strong>Confirm</strong><span>Apply the approved change once, with the same token.</span></li>
              </ol>
            </figure>
          </div>

          <div className={styles.guide}>
            <Section section={sections[0]}>
              <ul className={styles.auth}>
                {ADMIN_AGENT_API_AUTH.map((text) => <li key={text}>{text}</li>)}
              </ul>
              <ol className={shared.steps}>
                {ADMIN_AGENT_API_TOKEN_STEPS.map((text, index) => (
                  <li key={text}><span className={shared.stepNumber} aria-hidden="true">{index + 1}</span><p>{text}</p></li>
                ))}
              </ol>
              <div className={shared.inlineAction}>
                <Link className={shared.primaryLink} href="/work-os/admin/settings">Open Administration settings</Link>
              </div>
              <div className={shared.codeStack}>
                <h3>First call: verify the token and administrator identity</h3>
                <pre className={styles.code}><code>{ADMIN_AGENT_API_FIRST_CALL}</code></pre>
              </div>
              <div className={shared.agentPrompt}>
                <div className={shared.agentPromptCopy}>
                  <h3>Setup prompt for your agent</h3>
                  <p>{ADMIN_AGENT_API_AGENT_PROMPT}</p>
                </div>
                <Link className={shared.actionLink} href={ADMIN_AGENT_API_LLMS_PATH}>Read llms.txt</Link>
              </div>
            </Section>

            <Section section={sections[1]}>
              <dl className={shared.scopeList}>
                {ADMIN_AGENT_API_SCOPES.map(({ id, default: isDefault, purpose }) => (
                  <div className={shared.scopeRow} key={id}>
                    <dt><code>{id}</code></dt>
                    <dd><strong>{isDefault ? "Default read scope" : "Opt-in write scope"}</strong><p>{purpose}</p></dd>
                  </div>
                ))}
              </dl>
            </Section>

            <Section section={sections[2]}>
              <div className={shared.rules}>
                {ADMIN_AGENT_API_RULES.map(({ title, text }) => (
                  <div className={shared.rule} key={title}><h3>{title}</h3><p>{text}</p></div>
                ))}
              </div>
            </Section>

            <Section section={sections[3]}>
              <div className={shared.inlineAction}>
                <Link className={shared.actionLink} href={new URL(ADMIN_AGENT_API_OPENAPI_URL).pathname}>Read the OpenAPI schema</Link>
              </div>
              <div className={shared.endpointGroups}>
                {Object.entries(ADMIN_AGENT_API_GROUPS).map(([group, label]) => (
                  <div key={group}>
                    <h3 className={styles.groupTitle}>{label}</h3>
                    <ul className={shared.endpointList}>
                      {ADMIN_AGENT_API_ENDPOINTS.filter((endpoint) => endpoint.group === group).map((endpoint) => (
                        <li className={`${shared.endpoint} ${styles.endpoint}`} key={`${endpoint.method} ${endpoint.path}`}>
                          <div className={shared.endpointSignature}>
                            <span className={shared.method}>{endpoint.method}</span><code>{endpoint.path}</code>
                          </div>
                          <div className={shared.endpointPurpose}><p>{endpoint.purpose}</p></div>
                          <span className={shared.scope}>{adminEndpointScopeLabel(endpoint)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>

            <Section section={sections[4]}>
              <pre className={styles.code}><code>{ADMIN_AGENT_API_ERROR_ENVELOPE}</code></pre>
              <table className={`${shared.errorTable} ${styles.errors}`}>
                <caption>Administrator API error codes and what to do next</caption>
                <thead><tr><th scope="col">Code</th><th scope="col">HTTP</th><th scope="col">Next step</th></tr></thead>
                <tbody>
                  {ADMIN_AGENT_API_ERRORS.map(({ status, code, action }) => (
                    <tr key={code}><th scope="row"><code>{code}</code></th><td>{status}</td><td>{action}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section section={sections[5]}>
              <div className={shared.mcpHeader}><div><code>{ADMIN_AGENT_API_MCP_URL}</code></div></div>
              <p className={shared.helper}>{ADMIN_AGENT_API_MCP_RULE}</p>
              <dl className={shared.mcpTools}>
                {ADMIN_AGENT_API_MCP_TOOLS.map(({ name, scope, purpose }) => (
                  <div key={name}><dt><code>{name}</code></dt><dd><strong>{scope}</strong><p>{purpose}</p></dd></div>
                ))}
              </dl>
            </Section>
          </div>
        </div>
        <nav className={shared.toc} aria-label="On this page">
          <p>On this page</p>
          {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
      </div>
    </article>
  );
}
