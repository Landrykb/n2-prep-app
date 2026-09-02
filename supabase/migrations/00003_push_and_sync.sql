-- Add Anki progress to synced user state
alter table public.user_progress add column if not exists anki jsonb default '{}'::jsonb;

-- Push subscriptions for one user across devices
-- Keys stored as JSON: { p256dh, auth }
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "users own push subscriptions" on public.push_subscriptions;
create policy "users own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
