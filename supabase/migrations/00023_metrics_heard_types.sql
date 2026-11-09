-- Heard Words telemetry (Doc 22): the metrics type whitelist
-- predates the feature, so every ambient_chunk receipt and
-- every auto_listen_probe report has been silently rejected
-- since the day they were introduced (found 2026-11-09 by a
-- live end-to-end test — the client probes "never arriving"
-- and the missing chunk receipts were this constraint, not
-- the devices). Additive only: two types join the list.
alter table public.metrics_events drop constraint if exists metrics_events_type_check;
alter table public.metrics_events
  add constraint metrics_events_type_check
  check (type = any (array[
    'session_completed', 'diagnosis_completed', 'call_outcome',
    'effort_check', 'passage_sent', 'reading_opened',
    'passage_completed', 'word_tapped', 'word_mined',
    'shadow_attempted', 'shadow_scored', 'passage_generated',
    'generation_failed', 'reading_feedback', 'level_declared',
    'ambient_chunk', 'auto_listen_probe'
  ]));
