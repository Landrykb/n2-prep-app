-- 00025: the metrics type whitelist learns the dispatch types.
-- handleDispatch has logged 'dispatch_outcome' per due learner
-- since the integration audit, and the morning anti-repeat rule
-- (2026-11-11) logs 'passage_heldback' — but neither type was on
-- metrics_events_type_check, so every insert failed silently
-- (both loggers swallow insert errors by design). Zero
-- dispatch_outcome rows exist despite months of dispatches.
-- Same silent-telemetry class as 00023/00024.
alter table metrics_events drop constraint metrics_events_type_check;
alter table metrics_events add constraint metrics_events_type_check
  check (type = any (array[
    'session_completed', 'diagnosis_completed', 'call_outcome',
    'effort_check', 'passage_sent', 'reading_opened',
    'passage_completed', 'word_tapped', 'word_mined',
    'shadow_attempted', 'shadow_scored', 'passage_generated',
    'generation_failed', 'reading_feedback', 'level_declared',
    'ambient_chunk', 'auto_listen_probe', 'passage_dm',
    'dispatch_outcome', 'passage_heldback'
  ]));
