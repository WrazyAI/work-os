-- 0004: Worktivity audit — Layer 2 (sampled vision).
-- Adds the audit mode and the stored vision result (per-frame verdicts + flags +
-- recommended payable). Additive + idempotent.

alter table audit_runs add column if not exists mode text not null default 'metadata'
  check (mode in ('metadata', 'vision'));
alter table audit_runs add column if not exists vision jsonb;
