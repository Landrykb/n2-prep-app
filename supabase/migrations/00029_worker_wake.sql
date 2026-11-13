-- 00029: worker_wake — a content-free doorbell for the VM
-- voice worker (2026-11-13, the invocation diet).
--
-- The voice worker used to poll the voice-queue edge function
-- (1.5s + 10s loops, ~622k invocations in a billing period
-- against the free plan's 550k fair-use line). Landry's rule:
-- "if I'm not using it, it should not be doing anything." The
-- worker now sleeps and is woken two ways: a slow backstop
-- timer, and this doorbell — reader-bot / tts-vm insert one
-- row (inside the invocation that already enqueued the job,
-- so the poke costs NO extra invocation) and the worker,
-- holding one outbound Realtime websocket, hears the INSERT
-- and claims within ~1s.
--
-- The table carries nothing but an id and a timestamp: no
-- user data, no text. SELECT is open to anon/authenticated
-- so the worker can subscribe with the public anon key;
-- INSERTs happen only through the service role (the edge
-- functions), which bypasses RLS — there is deliberately no
-- insert policy, so no client can ring the bell.
create table if not exists public.worker_wake (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);

alter table public.worker_wake enable row level security;

create policy worker_wake_read on public.worker_wake
  for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.worker_wake;
