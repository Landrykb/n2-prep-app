-- 00026: push_subscriptions gains the updated_at column the
-- client has sent since the feature shipped. Without it,
-- PostgREST rejected every subscription upsert (PGRST204:
-- column not found in schema cache), savePushSubscription
-- swallowed the error to console, and the settings card
-- showed "on" from the LOCAL browser subscription while the
-- server held zero rows — no device could ever receive a
-- server push. Found 2026-11-11 by reproducing the client's
-- exact upsert with a throwaway account.
alter table push_subscriptions
  add column updated_at timestamptz not null default now();
