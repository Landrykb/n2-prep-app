-- 00012_reader_adaptive_fit.sql — Yonde Reader adaptive fit v1
-- (Doc 16 §5 amendment #4, Doc 12 step 3.6).
--
-- Landry's design, given live while testing amendment #3: a static
-- level is wrong even as a starting belief — the fit must ADAPT
-- ITSELF. Three columns on the link row carry the step state the
-- deterministic step logic (applyFeedback, in both fitting twins)
-- moves:
--
--   fit_step       — where /read aims relative to the learner's
--                    basis band, in [-1, 1]: 0 = at the basis,
--                    +1 = a stretch one band up. /read serves at
--                    serveBandFor(basis, fit_step); below-band deck
--                    credit still follows the BASIS band.
--   last_good_step — the PREVIOUS KNOWN level: the highest step
--                    proven comfortable (three comfortable reads
--                    ratchet it). Too Hard returns fit_step to
--                    exactly this value — back to proven ground,
--                    never a crash below it.
--   comfy_streak   — consecutive "Read It ✓" taps at the current
--                    step; at 3 the step is proven and trials up.
--
-- And one event type: every feedback tap logs 'reading_feedback'
-- { kind, passageId, fitStepAfter } to metrics_events — the tap
-- record, and the dedupe source (one tap per passage counts).
-- Read It ✓ is SELF-REPORT, honestly labelled as such (Doc 16 §5
-- amendment #4): chat cannot verify a learner read; the rich proof
-- is the R2 voice-note read-aloud, still gated.

alter table public.telegram_links
  add column if not exists fit_step int not null default 0,
  add column if not exists last_good_step int not null default 0,
  add column if not exists comfy_streak int not null default 0;

alter table public.metrics_events drop constraint if exists metrics_events_type_check;
alter table public.metrics_events
  add constraint metrics_events_type_check
  check (type in (
    'session_completed', 'diagnosis_completed', 'call_outcome', 'effort_check',
    'passage_sent', 'reading_opened', 'passage_completed', 'word_tapped',
    'word_mined', 'shadow_attempted', 'shadow_scored',
    'passage_generated', 'generation_failed',
    'reading_feedback'
  ));
