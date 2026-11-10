-- 00027: telegram_auth_diag — failure telemetry for the Mini App
-- identity bridge (Doc 16 §5 amendment #8's door). The bridge's
-- failures were invisible on both sides: the function returns
-- generic errors by design, and the client falls back to the
-- sign-in screen silently — when the owner reported the Mini
-- App no longer riding his linked Telegram (2026-11-11), neither
-- side could say which stage failed. This table holds one row
-- per diagnostic report: { client: { stage, hasWebApp,
-- initDataLen, hashHasTgData, platform }, validation, linkFound,
-- exchange } — stage words and booleans only, never initData,
-- never token material. Written by the telegram-auth function
-- (service role) from its diagOnly branch and its own failure
-- exits; read by the operator via SQL. RLS on, no policies:
-- service-role only.
create table if not exists public.telegram_auth_diag (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  payload jsonb not null
);
alter table public.telegram_auth_diag enable row level security;
