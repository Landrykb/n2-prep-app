alter table public.user_progress add column if not exists mocks jsonb default '{}'::jsonb;
alter table public.user_progress add column if not exists settings jsonb default '{}'::jsonb;
