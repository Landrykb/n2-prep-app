-- 00021_ambient_sessions_owner.sql — Heard Words app strip (Doc 22)
--
-- Phase A kept ambient_sessions service-role only because only
-- the bot touched it. The app's Heard Today strip (the pitch
-- panel's live state) needs two owner powers and no more:
--   SELECT own — show "Hori is listening" + since when.
--   DELETE own — a Stop that works from the app.
-- Sessions are still OPENED by the bot alone (no insert/update
-- policy exists), and the row an owner can see is their own:
-- their chat id, their card id, their day. Nothing about anyone
-- else, and nothing that can hold content — the 00020 schema
-- contract is untouched.

create policy ambient_sessions_select_own on public.ambient_sessions
  for select using (auth.uid() = user_id);

create policy ambient_sessions_delete_own on public.ambient_sessions
  for delete using (auth.uid() = user_id);
