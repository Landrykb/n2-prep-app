# AGENTS.md — rules for every agent working in this repo

Deployment rules live here because this repo deploys on Vercel; they bind every agent session.

## Deployment Bible — binding on every agent (Landry, 2026-11-10)

This repo deploys on Vercel. The rules below are law for every agent working here — Orion, Devin, or any other — and for every repo that deploys on Vercel, whichever Vercel account it uses. They exist because in November 2026 the team's committed billing coverage ran out mid-cycle while deployment cadence spiked (290 deployments in 6 days), and every build started billing in full at $0.0035 per build CPU minute. No agent may weaken, skip or reinterpret these rules; only Landry can amend them.

1. **Branch only.** Never commit or push directly to the production branch. All work happens on a feature branch.
2. **Validate locally before the PR.** Run the project's own gate on a local machine (typecheck with lockfile-faithful versions + a local production build) plus the surface verification the change touches (phone-width check for UI, a played/tested round for interactive features, the full surface pass for bots). Production is never the test bench.
3. **One batched PR per logical batch.** Accumulate related fixes into a single pull request instead of merging fix-by-fix. Every merge to the production branch is a billed production build (~$0.0035 per build CPU minute).
4. **Landry's merge tap is the only road to production.** Agents open PRs; Landry merges. No agent merges to the production branch on its own unless Landry has explicitly authorized that specific merge in the current conversation.
5. **Previews do not build.** Preview deployments are skipped at the Vercel project level (Ignored Build Step). Do not re-enable preview builds, and do not work around the skip to get a preview.
6. **Keep the ignore rules.** Where the repo carries a build-ignore rule (e.g. vercel.json ignoreCommand skipping builds when the app did not change), keep it working; docs-only and outside-app changes should not trigger a production build.
7. **Debug logs are dev-only.** Repeated production logs become billed observability events. Wrap diagnostic logging so it never runs in production.
8. **Verify after deploy by read-back.** A merge is not a deployment: confirm the deployment state and check the live surface before reporting anything as shipped.

---

## Supabase Bible — binding on every agent (Landry, 2026-11-10)

This repo uses Supabase. The rules below are law for every agent working here — Orion, Devin, or any other. They were each paid for by a real incident in November 2026. Only Landry can amend them.

1. **Act as the user by default.** User actions run with the user's own token under row-level security (RLS). The service role key is a master key that ignores every rule: reserve it for operator or background work across users, prefer a narrow SECURITY DEFINER function that can do only the one thing it was built for, and never place the service role key in client code or any NEXT_PUBLIC_* variable.
2. **RLS on every table, policies for every operation you use.** A table with SELECT/INSERT/UPDATE policies but no DELETE policy silently cannot delete — this exact gap broke account deletion. When you add an operation, add its policy in the same change.
3. **Respect the meters.** Egress and log ingestion are billed/limited (the free plan's grace ended at 227% egress and 683% log ingestion in November 2026). Narrow your queries, never poll or sync in a firehose loop, and keep diagnostic logging out of production.
4. **Pin critical auth settings explicitly.** Provider defaults change without asking (a sign-in code length changed under us in November 2026). Set OTP length, token expiry and confirmation behaviour deliberately; change auth config with minimal request bodies and verify by read-back.
5. **Migrations live in the repo as SQL files.** Apply them through the API or CLI, then verify by read-back (policies present, functions defined) before claiming the change exists. Nothing important lives only in a dashboard console.
6. **Account-level flows prove themselves on a throwaway.** Sign-up, deletion and reset are only "working" after a throwaway account goes through them and a database read-back shows the expected rows — a success screen is not proof.
