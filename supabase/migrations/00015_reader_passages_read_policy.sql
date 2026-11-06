-- 00015_reader_passages_read_policy.sql — Yonde Reader web surface
-- (Doc 16 §2/§7 R1: the /reader Mini App page inside the PWA).
--
-- reading_passages has been SERVICE-ROLE ONLY since 00009: RLS on, no
-- client policy, because in R0 the reader-bot edge function was the
-- only reader and fitting happened there. The web Reader fits IN THE
-- BROWSER with the same fitting core (src/lib/readerFit.js), so the
-- signed-in app needs to read the bank directly.
--
-- This adds exactly one policy: SELECT for authenticated users.
-- Passages are SHARED CONTENT — the same shelf for every learner,
-- written only by the seed / the Foundry cache path (service role) —
-- not user data: a row holds a text, its tokens and its band-level
-- new-word candidates, nothing about any learner. What is personal
-- (the learner's known set, their picks, their mined words) is
-- computed client-side from their own learner_state and is never in
-- this table. Writes stay service-role only: no insert/update/delete
-- policy is created, so clients still cannot touch the shelf.

drop policy if exists "signed-in users can read passages" on public.reading_passages;
create policy "signed-in users can read passages"
  on public.reading_passages
  for select to authenticated
  using (true);
