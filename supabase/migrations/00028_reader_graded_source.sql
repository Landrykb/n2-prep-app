-- 00028 — the graded-reader lane (Doc 16, bank growth 2026-11-11).
--
-- reading_passages.source gains 'graded': passages written FOR
-- the bank in mostly below-band vocabulary (src/data/readerBank.js,
-- built by scripts/build-reader-bank.mjs), labelled honestly as
-- authored-for-the-bank alongside 'bank' (found texts), 'scene'
-- (Voice Loop dialogues) and 'foundry' (accepted AI drafts).

alter table public.reading_passages drop constraint if exists reading_passages_source_check;
alter table public.reading_passages
  add constraint reading_passages_source_check
  check (source in ('bank', 'scene', 'foundry', 'graded'));
