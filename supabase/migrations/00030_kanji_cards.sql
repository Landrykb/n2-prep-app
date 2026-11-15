-- Kanji flash cards (Landry, 2026-11-15): when a learner meets
-- new kanji, the bot sends big designed picture cards of them in
-- Telegram — the kanji drawn from its stroke paths, readings,
-- meaning, common words — several times a day at first, then
-- across days. Repetition is the memory mechanism. This table
-- is the echo schedule: one row per (learner, kanji).
create table if not exists public.kanji_cards (
  user_id uuid not null,
  kanji text not null,
  first_seen_at timestamptz not null default now(),
  sends int not null default 0,
  next_due_at timestamptz not null default now(),
  last_sent_at timestamptz,
  primary key (user_id, kanji)
);
alter table public.kanji_cards enable row level security;
drop policy if exists kanji_cards_owner_select on public.kanji_cards;
create policy kanji_cards_owner_select on public.kanji_cards
  for select using (auth.uid() = user_id);

-- The send receipt is a metrics event; the whitelist learns it
-- in the same migration (the standing lesson: an unlisted type
-- fails silently forever).
alter table public.metrics_events drop constraint if exists metrics_events_type_check;
alter table public.metrics_events add constraint metrics_events_type_check
  check (type = any (array[
    'session_completed','diagnosis_completed','call_outcome','effort_check',
    'passage_sent','reading_opened','passage_completed','word_tapped','word_mined',
    'shadow_attempted','shadow_scored','passage_generated','generation_failed',
    'reading_feedback','level_declared','ambient_chunk','auto_listen_probe',
    'passage_dm','dispatch_outcome','passage_heldback','kanji_card_sent'
  ]));
