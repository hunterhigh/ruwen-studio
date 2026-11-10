-- Ordered reset barriers share the existing run event cursor and ownership boundary.
ALTER TABLE web_run_events ADD COLUMN event_type text NOT NULL DEFAULT 'delta';
ALTER TABLE web_run_events ADD COLUMN reset_reason text;
ALTER TABLE web_run_events ADD CONSTRAINT web_run_events_kind_check CHECK (
 (event_type='delta' AND reset_reason IS NULL) OR
 (event_type='reset' AND delta='' AND reset_reason IS NOT NULL AND reset_reason IN (
  'format_correction','prompt_overlap_correction','security_refusal'
 ))
);
