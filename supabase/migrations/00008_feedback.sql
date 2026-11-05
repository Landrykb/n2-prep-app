-- 00008_feedback.sql — In-app feedback (P1-8).
-- Written by src/lib/feedback.js when the learner is signed in; the
-- client always keeps a local copy too, and signed-out learners use a
-- mailto fallback instead (no anonymous insert path — a public insert
-- policy would be a spam hole, so there deliberately isn't one).

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  context text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback (created_at);

alter table public.feedback enable row level security;

drop policy if exists "users own feedback" on public.feedback;
create policy "users own feedback"
  on public.feedback
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
