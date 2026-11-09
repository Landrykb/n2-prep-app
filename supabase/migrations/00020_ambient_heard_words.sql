-- 00020_ambient_heard_words.sql — Heard Words (Doc 22, 2026-11-09)
--
-- The privacy contract is enforced by the schema: the ONLY thing
-- this feature can store is { user, day, dictionary item, kind,
-- count }. There is no column for audio, transcript text, a
-- sentence, a speaker, or a time finer than the day — so nothing
-- confidential can persist even if the code above it misbehaved.
--
-- ambient_sessions: one open listening session per private chat.
-- Service-role only (the bot), like voice_jobs.
-- heard_words: the day's counts. The owner may READ their own rows
-- (the app's Heard Today strip, Doc 22 step A5); writes are the
-- bot's alone, via the service role.

create table if not exists public.ambient_sessions (
  chat_id bigint primary key,
  user_id uuid not null,
  card_message_id bigint,
  day date not null,
  opened_at timestamptz not null default now()
);

create table if not exists public.heard_words (
  user_id uuid not null,
  day date not null,
  item text not null,
  kind text not null check (kind in ('word', 'expr')),
  count integer not null default 0 check (count >= 0),
  primary key (user_id, day, item)
);

alter table public.ambient_sessions enable row level security;
alter table public.heard_words enable row level security;

create policy heard_words_select_own on public.heard_words
  for select using (auth.uid() = user_id);
