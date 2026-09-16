-- Never re-POST after an uncertain provider create.
--
-- The outbox (0044) records the provider task id as soon as Nifty answers, but
-- there is a narrow window where the POST was dispatched and the id was never
-- written (worker crash or lost lease). A retry used to reconcile only through
-- a marker search over the Nifty list, so a listing that lagged behind the
-- just-created task could make the retry POST a second one.
--
-- provider_create_issued_at is written (fenced by apply_attempt) immediately
-- before the POST is dispatched. When a retry sees it set and still has no
-- provider_task_id, it ONLY searches — with bounded retries — and refuses to
-- POST again. A definite provider rejection (HTTP 4xx) clears the intent so a
-- corrected input can be filed; timeouts, network failures, and 5xx responses
-- keep it, because they cannot prove nothing was created.

alter table work_task_proposals add column if not exists provider_create_issued_at timestamptz;
