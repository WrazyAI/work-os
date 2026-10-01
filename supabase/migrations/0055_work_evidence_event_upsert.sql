-- The evidence mirror upserts provider events by evidence_event_id, but the
-- original unique index was partial (`where evidence_event_id is not null`),
-- which Postgres cannot use as an ON CONFLICT target. A full unique index is
-- equivalent for correctness because Postgres treats NULLs as distinct, and it
-- makes the idempotent provider-ingestion upsert possible.
drop index if exists work_evidence_event_uidx;
create unique index if not exists work_evidence_event_uidx on work_evidence (evidence_event_id);
