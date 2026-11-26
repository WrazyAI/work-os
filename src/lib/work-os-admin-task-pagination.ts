/** The desktop organization record must page the union, not page each
 * attribution source independently. Bind all inputs and scope both the
 * selected person and matching tasks to the authorized organization. */
// PostgreSQL's default btrim strips only spaces. Match JavaScript String.trim()
// for legacy provider IDs, including Unicode whitespace and line terminators.
export const adminPersonTaskPageSql = String.raw`
WITH person AS (
  SELECT id, CASE WHEN user_id = $2 THEN NULLIF(btrim(nifty_member_id, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '') END AS provider_id
  FROM work_people WHERE organization_id = $1 AND id = $3::uuid
), candidates AS (
  SELECT t.id, t.created_at,
    (t.assignee_person_ids @> ARRAY[p.id] OR (
      p.provider_id IS NOT NULL AND (
        t.assignee_provider_ids @> ARRAY[p.provider_id]
        OR t.raw ->> 'created_by' = p.provider_id
        OR t.raw -> 'subscribers' @> jsonb_build_array(p.provider_id)
      )
    )) IS TRUE AS directly_attributed,
    (t.assigned_by_person_id = p.id) IS TRUE AS delegated
  FROM work_tasks t CROSS JOIN person p
  WHERE t.organization_id = $1 AND t.user_id = $2
    AND t.status NOT IN ('archived', 'deleted')
    AND ($4::boolean IS NULL OR t.completed = $4)
    AND ($5::uuid IS NULL OR t.project_id = $5)
), page AS (
  SELECT id, created_at, NOT directly_attributed AS delegated_only
  FROM candidates WHERE directly_attributed OR delegated
  ORDER BY created_at DESC, id ASC
  OFFSET $6 LIMIT $7
), page_evidence AS (
  SELECT e.task_id, jsonb_agg(jsonb_build_object(
    'id', e.id, 'source', e.source, 'title', e.title, 'evidence_date', e.evidence_date
  ) ORDER BY e.id) AS evidence
  FROM work_evidence e JOIN page ON page.id = e.task_id
  WHERE e.organization_id = $1 AND e.user_id = $2
  GROUP BY e.task_id
)
SELECT t.*, page.delegated_only, to_jsonb(p) AS project,
  COALESCE(page_evidence.evidence, '[]'::jsonb) AS evidence
FROM page JOIN work_tasks t ON t.id = page.id
LEFT JOIN work_projects p ON p.id = t.project_id
  AND p.organization_id = t.organization_id AND p.user_id = t.user_id
LEFT JOIN page_evidence ON page_evidence.task_id = t.id
ORDER BY page.created_at DESC, page.id ASC
`;
