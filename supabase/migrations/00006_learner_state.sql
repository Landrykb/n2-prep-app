-- Readiness step 3 (P0-1, Doc 04 §3): the learner-state document —
-- the ONE queue, profile, diagnosis (+ history) and promise.
--
-- P0-1 in the Production Readiness investigation: the queue was
-- localStorage-only, so a browser cleanup, a new phone or a PWA
-- reinstall silently destroyed the exact asset the product exists to
-- accumulate. This table is the cloud half of the fix; the client half
-- is src/lib/stateSync.js (merge via src/lib/stateMerge.js: union for
-- the queue/history, newer-wins per document slice — merging never
-- loses learning, and sync is never a delete channel).
--
-- One row per user, the state stored as one jsonb document — the same
-- contract as learner_twin (00005): slice shapes evolve inside the
-- JSON document (Doc 04 §4), not as columns. Owner-only RLS, delete
-- cascades with the auth user like every other user table (Doc 15 §6).

create table if not exists public.learner_state (
  user_id uuid references auth.users on delete cascade primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.learner_state enable row level security;

drop policy if exists "users own learner state" on public.learner_state;
create policy "users own learner state"
  on public.learner_state for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
