-- 00011_reader_declared_band.sql — Yonde Reader declared level
-- (Doc 16 §5 amendment #3, Doc 12 step 3.6).
--
-- Landry's objection after the cold-start fix: he never entered a
-- level anywhere and filled nothing in, so the Reader must not gate
-- fitting on the in-app checkup. The declared level is the answer: a
-- STARTING BELIEF the learner states in ONE TAP inside Telegram
-- (the /read level ask, or /level any time). It is stored on the
-- link row the bot already owns:
--
--   declared_band — the tapped band, or NULL when never declared.
--   declared_at   — when it was tapped (the row's own record; no
--                   metrics event type is added for this).
--
-- Band resolution lives in code (resolveBand, both fitting twins):
-- a real diagnosis in learner_state ALWAYS overrides the declared
-- band; the passage footer labels which basis was used. RLS already
-- covers the row (owner-only policy from 00009); the bot writes via
-- the service role, like every other link write.

alter table public.telegram_links
  add column if not exists declared_band text
    check (declared_band in ('N5', 'N4', 'N3', 'N2', 'N1')),
  add column if not exists declared_at timestamptz;
