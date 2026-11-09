-- 00022_heard_words_bump_rpc.sql — Heard Words automatic mode (Doc 22)
--
-- The app's automatic listening matches speech against the
-- dictionary ON THE DEVICE and keeps nothing but counts — but
-- heard_words was owner-SELECT-only (00020), because until now
-- only the bot (service role) wrote it. This RPC is the one
-- write door for signed-in clients: it takes (item, kind)
-- pairs, one entry per hearing, and increments the CALLER'S
-- own row for today (Asia/Tokyo — the same day rule the bot
-- uses). A client cannot name another user, another day, or a
-- count: the function derives all three. The Doc 22 defences
-- ride along: kinds are word|expr only, items are capped at
-- 40 chars, and a pure digit/letter string can never persist
-- (figures and codenames are data, not vocabulary).

create or replace function public.bump_heard_words(p_items text[], p_kinds text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Tokyo')::date;
  v_n int;
  i int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_items is null or p_kinds is null then
    return;
  end if;
  v_n := least(coalesce(array_length(p_items, 1), 0), coalesce(array_length(p_kinds, 1), 0), 500);
  for i in 1 .. v_n loop
    if p_items[i] is null or length(p_items[i]) = 0 or length(p_items[i]) > 40 then
      continue;
    end if;
    if p_kinds[i] not in ('word', 'expr') then
      continue;
    end if;
    if p_items[i] ~ '^[0-9a-zA-Z]+$' then
      continue;
    end if;
    insert into public.heard_words (user_id, day, item, kind, count)
    values (v_user, v_day, p_items[i], p_kinds[i], 1)
    on conflict (user_id, day, item)
    do update set count = public.heard_words.count + 1, kind = excluded.kind;
  end loop;
end;
$$;

revoke all on function public.bump_heard_words(text[], text[]) from public;
grant execute on function public.bump_heard_words(text[], text[]) to authenticated;
