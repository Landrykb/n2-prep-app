# JPN2easy — AI-Powered JLPT N2 Study Command Center

A Vite + React + Tailwind app for preparing for the JLPT N2, now with user accounts, an AI tutor, and Supabase-powered vector search (RAG).

## Stack

- **Frontend:** Vite, React 19, Tailwind CSS, Lucide icons
- **Hosting:** Vercel (static SPA)
- **Auth + Database + Vector search:** Supabase
- **AI:** OpenRouter (free chat + embedding models)
- **Vector DB:** `pgvector` via Supabase Postgres

## Quick start (local)

```bash
npm install
npm run dev
```

The app works in read-only mode if no Supabase credentials are provided. For full features, connect Supabase and OpenRouter.

## Environment variables

Copy `.env.example` to `.env` and fill in:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

OpenRouter is configured in Supabase Edge Function secrets, not the browser bundle:

```bash
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_CHAT_MODEL=openrouter/free
OPENROUTER_EMBEDDING_MODEL=liquid/lfm-2.5-embedding-350m:free
APP_URL=https://your-app.vercel.app
```

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migration:
   ```bash
   npx supabase migration up
   # or run SQL from supabase/migrations/00001_initial.sql in the SQL Editor
   ```
3. Seed the N2 study data:
   ```bash
   node scripts/build-seed.mjs
   # then run supabase/seed.sql in the SQL Editor
   ```
4. Generate embeddings for the seed chunks:
   ```bash
   npx supabase functions deploy embed
   npx supabase functions deploy chat
   ```
5. Set Edge Function secrets in Supabase:
   ```bash
   npx supabase secrets set OPENROUTER_API_KEY=your-openrouter-key
   npx supabase secrets set OPENROUTER_CHAT_MODEL=openrouter/free
   npx supabase secrets set OPENROUTER_EMBEDDING_MODEL=liquid/lfm-2.5-embedding-350m:free
   npx supabase secrets set APP_URL=https://your-app.vercel.app
   ```
6. Call the `embed` function once (e.g. via curl or the Supabase dashboard test runner) to populate `n2_chunks.embedding`.

## Deploy to Vercel

1. Push to a GitHub/GitLab repo.
2. Import the repo in Vercel.
3. Add the environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in Vercel's dashboard and name the project `JPN2easy`.
4. Deploy.

## User isolation

- Supabase Auth provides email/password sign-up and sign-in.
- In-client localStorage is keyed by user ID, so switching accounts on the same browser switches data.
- `error_logs` and `user_progress` tables are ready in Supabase with Row-Level Security for per-user server-side data if you choose to sync progress next.

## AI Tutor / RAG

The AI tutor lives in the **AI Tutor** tab. It:

1. Sends the user's question to Supabase Edge Function `chat`.
2. The function embeds the question with `liquid/lfm-2.5-embedding-350m:free`.
3. It does a `pgvector` similarity search over `n2_chunks`.
4. It sends the top chunks + the question to `openrouter/free` (or another free chat model).
5. Returns a grounded N2-specific answer.
