-- 00017_telegram_user_id.sql — Telegram Mini App identity bridge
-- (Doc 16 §5 amendment #8, 2026-11-07).
--
-- telegram_links originally stored only chat_id. That identifies
-- the conversation the bot writes to, but Telegram's signed Mini
-- App initData identifies the USER (user.id). In a private chat
-- the two numbers are identical, which is why every existing
-- claimed row can be backfilled safely below — but they are not
-- the same concept, and the identity bridge must not depend on a
-- chat-shaped coincidence forever.
--
-- telegram_user_id is therefore the durable identity key for
-- Mini App auth. reader-bot now writes it from message.from.id on
-- every new claim; chat_id remains the delivery address. The
-- unique index keeps one Telegram user bound to at most one
-- Yonde account (Postgres unique indexes still allow any number
-- of unclaimed NULL rows).

alter table public.telegram_links
  add column if not exists telegram_user_id bigint;

update public.telegram_links
set telegram_user_id = chat_id
where telegram_user_id is null
  and chat_id is not null
  and linked_at is not null;

create unique index if not exists telegram_links_telegram_user_id_key
  on public.telegram_links (telegram_user_id);
