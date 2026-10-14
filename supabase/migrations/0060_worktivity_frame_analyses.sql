-- 0060: Shared per-frame Worktivity screenshot analysis cache.
--
-- Rows hold derived analysis only — image fingerprints (exact sha256 + 64-bit
-- perceptual dHash) and, for frames the audit vision pass sampled, the
-- role-rubric classification. Image bytes and pre-signed provider URLs are
-- never stored.
--
-- Producers: the Work OS screenshot pipeline (fingerprint of every frame it
-- already downloads for recap/EOD evidence) and the Worktivity audit vision
-- pass (fingerprints + classifications). The audit reads rows back so a frame
-- analyzed earlier is not downloaded or classified again while its inputs are
-- unchanged: `fingerprint_version` pins the hash algorithm, and
-- `classification_key` pins prompt version, vision model, rubric hash, and the
-- exact image content that was judged.
--
-- Server-only: producers and reader use the service-role admin client. RLS is
-- enabled with no policies, so every other role is denied.
create table if not exists worktivity_frame_analyses (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,               -- Worktivity Employee.ID
  screenshot_id text not null,             -- Worktivity Screenshot.ID
  captured_at timestamptz,
  local_date date,
  app text,
  url text,
  activity_level integer,
  exact_hash text,
  perceptual_hash text,
  fingerprint_version integer,
  fingerprint_at timestamptz,
  classification jsonb,
  classification_key text,
  classification_model text,
  classification_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, screenshot_id)
);
create index if not exists worktivity_frame_analyses_employee_capture_idx
  on worktivity_frame_analyses (employee_id, captured_at);
create index if not exists worktivity_frame_analyses_captured_idx
  on worktivity_frame_analyses (captured_at);

alter table worktivity_frame_analyses enable row level security;
