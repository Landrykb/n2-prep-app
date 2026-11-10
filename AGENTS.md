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
