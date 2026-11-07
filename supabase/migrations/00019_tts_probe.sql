-- 00019_tts_probe.sql — server-side trace for the tts-vm route
-- (2026-11-08). Landry's taps were failing with 'server-tts-
-- null' while NO job ever reached voice_jobs: the request died
-- somewhere between his client and the function's insert, and
-- neither side could see where. tts-vm now writes one row per
-- stage it reaches (arrived / auth-fail / bad-body / cache-hit
-- / inserted / done / timeout / insert-fail) so a single tap
-- names its own failing step in a table support can read.
-- Service-role only, like voice_jobs: RLS on, no policies.
-- Probe rows are operational noise — they carry stage names
-- and short details only, never text or tokens.

create table if not exists public.tts_probe (
  id bigint generated always as identity primary key,
  stage text not null,
  detail text,
  at timestamptz not null default now()
);

alter table public.tts_probe enable row level security;
