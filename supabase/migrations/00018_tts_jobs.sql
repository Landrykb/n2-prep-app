-- 00018_tts_jobs.sql — a synchronous lane on the Voice Worker
-- queue (Doc 17 addendum 5, 2026-11-08).
--
-- The `tts` edge function's own synthesis is dead from Supabase's
-- datacenter egress (probed 2026-11-08: its own 502, twice), so
-- the app's server voice route moves to the same VM whose
-- egress Microsoft answers: the client asks the new `tts-vm`
-- function, which enqueues a kind='tts' job here and waits for
-- the worker to hand the audio back through voice-queue
-- (tts-claim / tts-complete — a fast poll lane beside the
-- passage lane's 10 s loop). Passage jobs are untouched:
-- kind defaults to 'passage' and both claims are kind-scoped.
--
-- voice_cast carries the app's cast name (female/male/girl/
-- boy — src/lib/voiceCast.js); the worker maps it to its Edge
-- voice + pitch. user_id records whose line it was. Audio for
-- tts jobs is MP3 (the web plays it everywhere; the passage
-- lane's ogg/opus is a Telegram requirement, not a web one).

alter table public.voice_jobs
  add column if not exists kind text not null default 'passage';
alter table public.voice_jobs
  add column if not exists voice_cast text;
alter table public.voice_jobs
  add column if not exists user_id uuid;

create index if not exists voice_jobs_tts_pending_idx
  on public.voice_jobs (created_at)
  where status = 'pending' and kind = 'tts';
