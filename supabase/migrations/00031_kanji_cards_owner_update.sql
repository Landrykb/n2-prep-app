-- Kanji cards in the app (2026-11-15): the deck lives in the
-- app too, harmonized with Telegram — the learner flips cards
-- and taps Got it / Forgot it there, writing the SAME echo
-- schedule the bot sends from. Owners may update their own
-- rows (sends / next_due_at); inserts stay service-role
-- (registration happens inside the serve functions).
drop policy if exists kanji_cards_owner_update on public.kanji_cards;
create policy kanji_cards_owner_update on public.kanji_cards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
