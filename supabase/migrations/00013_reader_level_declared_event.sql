-- 00013 — admit the level_declared metric (Doc 16 §5 amendment #3
-- follow-through). The one-tap declaration was recorded only as
-- declared_at on telegram_links; without an event it cannot be counted
-- or correlated with later reading behaviour. Same widening pattern as
-- 00009/00010/00012: drop + re-add the closed type list, full union.

alter table public.metrics_events drop constraint if exists metrics_events_type_check;
alter table public.metrics_events
  add constraint metrics_events_type_check
  check (type in (
    'session_completed', 'diagnosis_completed', 'call_outcome', 'effort_check',
    'passage_sent', 'reading_opened', 'passage_completed', 'word_tapped',
    'word_mined', 'shadow_attempted', 'shadow_scored',
    'passage_generated', 'generation_failed',
    'reading_feedback', 'level_declared'
  ));
