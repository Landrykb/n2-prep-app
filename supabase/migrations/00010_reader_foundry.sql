-- 00010_reader_foundry.sql — Yonde Reader R0.5 (Doc 16 §7, Doc 12
-- step 3.6): fitted generation pulled forward from R1. Two widenings,
-- nothing else:
--
--   reading_passages.source — generated passages that pass the SAME
--     0.93–0.97 gate are cached back into the bank with source
--     'foundry' (Doc 16 §4: a good passage can serve similar learners
--     after per-learner re-fitting). 00009 admitted only bank/scene.
--
--   metrics_events.type — the generation loop logs 'passage_generated'
--     (attempts + final ratio) and 'generation_failed' (Doc 16 §8
--     family); 00009's check does not admit them yet.

alter table public.reading_passages drop constraint if exists reading_passages_source_check;
alter table public.reading_passages
  add constraint reading_passages_source_check
  check (source in ('bank', 'scene', 'foundry'));

alter table public.metrics_events drop constraint if exists metrics_events_type_check;
alter table public.metrics_events
  add constraint metrics_events_type_check
  check (type in (
    'session_completed', 'diagnosis_completed', 'call_outcome', 'effort_check',
    'passage_sent', 'reading_opened', 'passage_completed', 'word_tapped',
    'word_mined', 'shadow_attempted', 'shadow_scored',
    'passage_generated', 'generation_failed'
  ));
