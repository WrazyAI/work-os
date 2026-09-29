-- Work OS voice input (record-to-transcribe in the companion chat composer and
-- the web check-in composer).
--
-- The capability follows the Employee Companion: an organization already
-- running the companion gains voice input, an organization that does not stays
-- off, and re-running this migration changes nothing.

update work_organizations
set feature_flags = coalesce(feature_flags, '{}'::jsonb) || '{"voice_input": true}'::jsonb
where feature_flags->>'employee_companion' = 'true'
  and not (coalesce(feature_flags, '{}'::jsonb) ? 'voice_input');
