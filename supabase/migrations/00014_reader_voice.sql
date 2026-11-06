-- 00014_reader_voice.sql — Yonde Reader voice-out cache
-- (Doc 16, 2026-11-06 late: R1/R2 pulled forward).
--
-- Every passage the bot sends is also sent as a Telegram voice note
-- (Microsoft Edge TTS, ja-JP-NanamiNeural — free, no API key; the
-- keyed upgrade route is Doc 17's Google Neural2). Synthesis is the
-- only expensive step, and a passage's text never changes, so the
-- FIRST successful synthesis+send stores Telegram's own file_id on
-- the row; every later send of that passage is a free sendVoice by
-- file_id. Nullable: bank rows start unsynthesised, and a passage
-- whose synthesis failed simply retries next send (voice is an
-- enhancement — the text send never depends on it).

alter table public.reading_passages
  add column if not exists voice_file_id text;
