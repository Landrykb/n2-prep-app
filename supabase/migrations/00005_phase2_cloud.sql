-- Phase 2 cloud layer (Doc 02 §5, Doc 04 §3, Doc 09 §7 activation checklist).
--
-- Three tables only — the subset of Doc 04's target schema that Phase 2
-- actually ships code against:
--   learner_twin    — cloud mirror of jpn:twin:v1 (Doc 04 §3 `twin`, stored
--                     as one jsonb document: the Twin's shape evolves inside
--                     the JSON contract in Doc 04 §4, so the row is the
--                     document + its updated_at, not a column per section)
--   call_windows    — the signed-in user's Yobidashi call settings, synced
--                     by the client so the server scheduler can ring a
--                     closed app (Doc 02 §3.2). Slot *generation* stays
--                     client-deterministic; the scheduler ports the same
--                     hash (src/lib/calls.js <-> call-scheduler/slot.ts).
--   call_dispatches — one row per server-sent summons, keyed by slot id;
--                     the primary key IS the dedupe (insert-or-ignore).
--
-- Delete-account needs NO migration here: every existing user table
-- (error_logs + user_progress in 00001, push_subscriptions in 00003) already
-- references auth.users `on delete cascade`, and so do the tables below —
-- deleting the auth user cascades everything (Doc 15 §6).

-- Learner Twin cloud mirror: one row per user, owner-only RLS.
create table if not exists public.learner_twin (
  user_id uuid references auth.users on delete cascade primary key,
  twin jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.learner_twin enable row level security;

drop policy if exists "users own learner twin" on public.learner_twin;
create policy "users own learner twin"
  on public.learner_twin for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Yobidashi call settings for the server scheduler: one row per user.
create table if not exists public.call_windows (
  user_id uuid references auth.users on delete cascade primary key,
  enabled boolean not null default false,
  windows jsonb not null default '[]'::jsonb,
  calls_per_day int not null default 1,
  persistence text not null default 'standard',
  sensei_name text not null default 'Sensei',
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

alter table public.call_windows enable row level security;

drop policy if exists "users own call windows" on public.call_windows;
create policy "users own call windows"
  on public.call_windows for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Server summons log / dedupe. Written ONLY by the call-scheduler edge
-- function (service role bypasses RLS). Users may read their own rows (the
-- client shows "a summons was sent" state from this in a later pass); they
-- may not write — a client must never be able to fake or suppress a dispatch.
create table if not exists public.call_dispatches (
  slot_id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  slot_date date not null,
  window_idx int not null,
  slot_at timestamptz not null,
  status text not null default 'sent',
  sent_at timestamptz not null default now()
);

alter table public.call_dispatches enable row level security;

drop policy if exists "users read own call dispatches" on public.call_dispatches;
create policy "users read own call dispatches"
  on public.call_dispatches for select to authenticated
  using (auth.uid() = user_id);
