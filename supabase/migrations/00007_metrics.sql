-- 00007_metrics.sql — Gate metrics (P1-7, Doc 11 §Gate metrics).
-- One row per gate event, written best-effort by the client when signed
-- in (src/lib/metrics.js). Local storage remains the on-device truth;
-- these rows exist so a cohort can be read across devices.
--
-- PRIVACY SHAPE: rows are owner-only through the API (RLS below) — a
-- learner can read and write ONLY their own events. The cohort summary
-- view is deliberately NOT exposed through the API: it is read with the
-- service role / SQL editor by the operator only (see the view comment).
-- Aggregate counts leave no way to identify a learner at cohort sizes
-- the view reports (it refuses cohorts under 5 learners).

create table if not exists public.metrics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('session_completed', 'diagnosis_completed', 'call_outcome', 'effort_check')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists metrics_events_user_created_idx
  on public.metrics_events (user_id, created_at);
create index if not exists metrics_events_type_created_idx
  on public.metrics_events (type, created_at);

alter table public.metrics_events enable row level security;

drop policy if exists "users own metrics events" on public.metrics_events;
create policy "users own metrics events"
  on public.metrics_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Cohort summary — OPERATOR-ONLY. Not granted to anon/authenticated;
-- read via service role for the weekly Doc 11 review. Reports counts
-- and the North Star (minutes per proof point) only when at least 5
-- distinct learners contributed, so small-cohort rows can never single
-- anyone out.
create or replace view public.metrics_cohort_summary as
select
  type,
  count(*) as events,
  count(distinct user_id) as learners,
  case when count(distinct user_id) >= 5
    then round(sum(coalesce((payload->>'minutes')::numeric, 0)) /
         nullif(sum(coalesce((payload->>'proof')::numeric, 0)), 0), 1)
  end as minutes_per_proof_point
from public.metrics_events
group by type;

revoke all on public.metrics_cohort_summary from anon, authenticated;
