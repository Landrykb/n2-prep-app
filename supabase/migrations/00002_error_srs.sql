-- Add SRS fields for error log review
alter table public.error_logs add column if not exists review_count int not null default 0;
alter table public.error_logs add column if not exists next_review timestamptz not null default now() + interval '1 day';
