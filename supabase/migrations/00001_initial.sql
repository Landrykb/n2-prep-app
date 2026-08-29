-- Enable pgvector for semantic search
create extension if not exists vector;

-- N2 study chunks used by the RAG tutor
-- Embeddings are generated and back-filled by the `embed` edge function.
create table if not exists public.n2_chunks (
  id bigint generated always as identity primary key,
  content text not null,
  source text not null,
  metadata jsonb default '{}'::jsonb,
  embedding vector(1024),
  created_at timestamptz default now()
);

-- User-generated error log (isolated per user)
create table if not exists public.error_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  section text not null,
  mistake text not null,
  cause text default '',
  fix text default '',
  created_at timestamptz default now()
);

-- User progress (streak, daily drill state, etc.)
create table if not exists public.user_progress (
  user_id uuid references auth.users on delete cascade primary key,
  streak jsonb default '{"count":0,"last":""}'::jsonb,
  daily jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- RLS: only authenticated users can read/write their own data
alter table public.error_logs enable row level security;
alter table public.user_progress enable row level security;

-- n2_chunks are global study material; allow all authenticated users to read
drop policy if exists "n2 chunks readable by authenticated users" on public.n2_chunks;
create policy "n2 chunks readable by authenticated users"
  on public.n2_chunks for select to authenticated using (true);

drop policy if exists "users own error logs" on public.error_logs;
create policy "users own error logs"
  on public.error_logs for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users own progress" on public.user_progress;
create policy "users own progress"
  on public.user_progress for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Vector similarity search for the AI tutor
create or replace function public.match_n2_chunks(
  query_embedding vector(1024),
  match_threshold float,
  match_count int
)
returns table(
  id bigint,
  content text,
  source text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    n2_chunks.id,
    n2_chunks.content,
    n2_chunks.source,
    n2_chunks.metadata,
    1 - (n2_chunks.embedding <=> query_embedding) as similarity
  from public.n2_chunks
  where n2_chunks.embedding is not null
    and 1 - (n2_chunks.embedding <=> query_embedding) > match_threshold
  order by n2_chunks.embedding <=> query_embedding
  limit match_count;
$$;
