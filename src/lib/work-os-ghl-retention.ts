import { getPool } from "./db/pool";

type Json = Record<string, any>;

export const GHL_EXPIRED_EVIDENCE_NOTICE = "[GHL email evidence expired and was redacted]";

/** Only machine-generated fields that may carry an email-derived copy. A new
 * consumer must be added here deliberately; arbitrary table/field names from a
 * database row can never become SQL. */
const CONSUMER_FIELDS: Record<string, Set<string>> = {
  work_activity_intervals: new Set(["headline", "ai_detail", "final_detail", "structured_summary"]),
  work_evidence: new Set(["summary"]),
  work_reports: new Set(["generated_markdown", "submitted_markdown"]),
  work_report_versions: new Set(["markdown"]),
};

export async function registerGhlContentReference(input: {
  organizationId: string;
  contentId: string;
  consumerTable: string;
  consumerId: string;
  consumerField: string;
}): Promise<void> {
  if (!CONSUMER_FIELDS[input.consumerTable]?.has(input.consumerField)) {
    throw new Error("GHL content reference target is not allowlisted");
  }
  await getPool().query(
    `insert into work_ghl_content_references
      (organization_id, content_id, consumer_table, consumer_id, consumer_field)
     values ($1,$2,$3,$4,$5)
     on conflict (content_id, consumer_table, consumer_id, consumer_field) do nothing`,
    [input.organizationId, input.contentId, input.consumerTable, input.consumerId, input.consumerField],
  );
}

/** Deletes expired email content and replaces every registered machine copy
 * with a fixed notice. Employee-authored text, task state and review decisions
 * are never rewritten by this pass. */
export async function purgeExpiredGhlContent(now: Date): Promise<{ expired: number; referencesRedacted: number }> {
  const expiredRows = await getPool().query(
    `select id, organization_id from work_ghl_email_content
      where expires_at <= $1 and content_purged_at is null
      order by expires_at limit 500`,
    [now.toISOString()],
  );
  let expired = 0;
  let referencesRedacted = 0;
  for (const row of expiredRows.rows as Json[]) {
    const references = await getPool().query(
      "select consumer_table, consumer_id, consumer_field from work_ghl_content_references where content_id = $1",
      [row.id],
    );
    for (const reference of references.rows as Json[]) {
      const table = String(reference.consumer_table);
      const field = String(reference.consumer_field);
      if (!CONSUMER_FIELDS[table]?.has(field)) continue;
      const value = field === "structured_summary" ? "to_jsonb($1::text)" : "$1";
      const updated = await getPool().query(
        `update ${table} set ${field} = ${value} where id = $2::uuid returning id`,
        [GHL_EXPIRED_EVIDENCE_NOTICE, String(reference.consumer_id)],
      );
      if (updated.rows.length > 0) referencesRedacted += 1;
    }
    await getPool().query(
      `update work_ghl_email_content
          set excerpt_cipher = null, summary_cipher = null, content_hash = '', content_purged_at = $1, updated_at = now()
        where id = $2`,
      [now.toISOString(), row.id],
    );
    await getPool().query(
      `insert into work_audit_log (organization_id, actor_user_id, action, target_type, target_id, metadata)
       values ($1,null,'ghl_content.retention_purged','ghl_email_content',$2,$3)`,
      [row.organization_id, String(row.id), JSON.stringify({ referencesRedacted: references.rows.length })],
    );
    expired += 1;
  }
  return { expired, referencesRedacted };
}
