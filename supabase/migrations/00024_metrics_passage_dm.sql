-- DM mirror telemetry (2026-11-10): the cooked passage sent
-- to the learner's bot DM logs a passage_dm event; the type
-- joins the whitelist before the first insert can be silently
-- rejected (the 00023 lesson: an unlisted type fails without
-- a sound, and the failure looks like the feature's absence).
alter table public.metrics_events drop constraint if exists metrics_events_type_check;
alter table public.metrics_events
  add constraint metrics_events_type_check
  check (type = any (array[
    'session_completed', 'diagnosis_completed', 'call_outcome',
    'effort_check', 'passage_sent', 'reading_opened',
    'passage_completed', 'word_tapped', 'word_mined',
    'shadow_attempted', 'shadow_scored', 'passage_generated',
    'generation_failed', 'reading_feedback', 'level_declared',
    'ambient_chunk', 'auto_listen_probe', 'passage_dm'
  ]));
