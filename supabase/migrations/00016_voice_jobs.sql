-- 00016_voice_jobs.sql — Yonde Voice Worker queue + audio cache
-- (Doc 16 §5 amendment #6, 2026-11-07).
--
-- Why this exists: Microsoft's Edge TTS endpoint refuses synthesis
-- from Supabase's datacenter egress (proven 2026-11-06, three 502s
-- out of the `tts` function), but answers fine from Landry's own
-- always-on VM. Passages are cached assets — each is synthesized
-- ONCE and reused forever via Telegram file_id — so synthesis moves
-- to a tiny polling worker on the VM (~/voice-worker/worker.py),
-- and this table is its job queue:
--
--   reader-bot (this project) finds a passage has no voice yet and
--   inserts a `pending` row → the VM worker claims the oldest
--   pending job through the `voice-queue` edge function (its only
--   door; x-worker-secret auth) → synthesizes + converts to
--   ogg/opus → hands the bytes back (`complete`) → voice-queue
--   stores them in the private `voice-cache` bucket and pokes
--   reader-bot (?voicejob=<id>), which downloads the audio,
--   sendVoices it to the job's chat, caches the Telegram file_id
--   on the passage row (migration 00014), and marks the job `sent`.
--   The morning dispatch sweeps any `done`-but-unsent jobs as a
--   backstop, so a missed callback can delay a voice note but can
--   never lose one.
--
-- voice_jobs is SERVICE-ROLE ONLY, like reading_passages: RLS is
-- enabled and NO policy exists, so anon/authenticated roles can
-- neither read nor write it through the API — reader-bot and
-- voice-queue (both service-role) are the only hands on it, and the
-- worker reaches it only through voice-queue's secret gate.

create table if not exists public.voice_jobs (
  id uuid primary key default gen_random_uuid(),
  -- The passage this voice belongs to (reading_passages.id — text,
  -- like every other passage reference in the Reader).
  passage_id text,
  -- The private chat the voice note is delivered to.
  chat_id bigint,
  -- The passage body — the exact text to synthesize. Stored on the
  -- job so the worker needs no other door into the bank.
  text text,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'done', 'sent', 'failed')),
  -- Object path inside the voice-cache bucket (`<jobId>.ogg`),
  -- written by voice-queue on `complete`.
  storage_path text,
  -- Short failure note (worker-reported or function-side), capped
  -- by the writers; null unless failed.
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  sent_at timestamptz
);

alter table public.voice_jobs enable row level security;

-- The claim query (oldest pending first) rides this index.
create index if not exists voice_jobs_pending_idx
  on public.voice_jobs (created_at)
  where status = 'pending';

-- The private audio cache. Bytes land here on `complete` and are
-- downloaded by reader-bot for the sendVoice; the Telegram file_id
-- cached on the passage is the long-term copy, this bucket is the
-- hand-off. Idempotent: safe to re-run alongside the table DDL.
insert into storage.buckets (id, name, public)
values ('voice-cache', 'voice-cache', false)
on conflict (id) do nothing;
