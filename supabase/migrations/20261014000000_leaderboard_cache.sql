-- First stress test fixes (approved by Om, Oct 9 2026).
--   B. The leaderboard is calculated at most once every 30 seconds and kept
--      in a saved copy that every visit reads, instead of being recalculated
--      for each visit (300 students at once used to time out).
--   C. The leaderboard sent to browsers is slimmer: challenge points are a
--      list in column order (not keyed by long IDs) and empty fields are
--      left out.
--   A. Photos are capped at 1 MB each (the site shrinks them to about
--      15 KB before upload).
-- Who can see what is unchanged; the saved copies can only be read through
-- get_leaderboard / get_my_standing, which apply the same rules as before.
-- The student view is saved too (it's the same for every student); each
-- browser marks its own row by username.

create table public.leaderboard_cache (
  event_id uuid primary key references public.events (id) on delete cascade,
  data jsonb not null,
  stamp text not null, -- changes whenever the standings change
  computed_at timestamptz not null default now()
);
alter table public.leaderboard_cache enable row level security;
-- No policies: nobody reads this table directly.
revoke all on public.leaderboard_cache from anon, authenticated;

create or replace function public.cached_leaderboard(p_event uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.leaderboard_cache;
  lock_key bigint := hashtextextended('leaderboard:' || p_event::text, 0);
  -- 30 seconds; the automated tests set campus.leaderboard_cache_seconds
  -- to 0 so every check sees its own changes straight away.
  max_age interval := make_interval(secs => coalesce(nullif(current_setting('campus.leaderboard_cache_seconds', true), '')::int, 30));
  fresh jsonb;
begin
  select * into c from public.leaderboard_cache where event_id = p_event;
  if found and c.computed_at > now() - max_age then
    return c.data || jsonb_build_object('stamp', c.stamp);
  end if;
  if found then
    -- Someone else is already refreshing it: use the copy we have.
    if not pg_try_advisory_xact_lock(lock_key) then
      return c.data || jsonb_build_object('stamp', c.stamp);
    end if;
  else
    -- No copy yet: wait for whoever is making the first one.
    perform pg_advisory_xact_lock(lock_key);
  end if;
  -- It may have been refreshed while we waited.
  select * into c from public.leaderboard_cache where event_id = p_event;
  if found and c.computed_at > now() - max_age then
    return c.data || jsonb_build_object('stamp', c.stamp);
  end if;
  fresh := public.compute_leaderboard(p_event);
  insert into public.leaderboard_cache (event_id, data, stamp, computed_at)
  values (p_event, fresh, md5(fresh::text), now())
  on conflict (event_id) do update set data = excluded.data, stamp = excluded.stamp, computed_at = excluded.computed_at;
  return fresh || jsonb_build_object('stamp', md5(fresh::text));
end $$;

-- Same rules as before; live standings now come from the saved copy.
-- (Freezing still saves the true current standings: snapshot_on_freeze
-- calculates them directly.)
create or replace function public.leaderboard_source(p_event uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st public.leaderboard_state;
  snap public.leaderboard_snapshots;
begin
  select leaderboard_state into st from public.settings where event_id = p_event;
  if st is null then return null; end if;
  if public.is_admin() or st = 'live' then
    return public.cached_leaderboard(p_event) || jsonb_build_object('state', st);
  end if;
  if st = 'hidden' then
    return jsonb_build_object('state', st);
  end if;
  select * into snap from public.leaderboard_snapshots where event_id = p_event;
  return jsonb_build_object('state', st, 'individual', coalesce(snap.individual, '[]'), 'teams', coalesce(snap.teams, '[]'),
                            'courses', coalesce(snap.courses, '[]'), 'taken_at', snap.taken_at);
end $$;

-- One individual row as sent to the browser: no person ID, points as a list
-- in column order, course slots without their position, and empty fields
-- left out. (Each browser marks its own row by username.)
create or replace function public.lb_slim(r jsonb, ids jsonb)
returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'username', r -> 'username',
    'avatar', r -> 'avatar',
    'team', r -> 'team',
    'total', r -> 'total',
    'rank', r -> 'rank',
    'courses', (select coalesce(jsonb_agg(jsonb_build_object(
                   'name', case when (c ->> 'extrapolated')::boolean then null else c -> 'name' end,
                   'points', c -> 'points',
                   'extrapolated', case when (c ->> 'extrapolated')::boolean then true end) order by n), '[]')
                from jsonb_array_elements(r -> 'courses') with ordinality as x(c, n)),
    'points', (select coalesce(jsonb_agg(r -> 'challenges' -> (i #>> '{}') order by n), '[]')
               from jsonb_array_elements(ids) with ordinality as y(i, n))
  ))
$$;

-- The board as a browser sees it, minus anything about the viewer. Admins
-- get every student and the calculated takeovers; everyone else gets the
-- cutoffs.
create or replace function public.lb_view(src jsonb, ev uuid, admin boolean)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  ids jsonb;
begin
  select * into s from public.settings where event_id = ev;
  select coalesce(jsonb_agg(ch.id order by ch.sort, ch.name), '[]') into ids
    from public.challenges ch where ch.event_id = ev and ch.visible;
  return jsonb_build_object(
    'state', src ->> 'state',
    'taken_at', src -> 'taken_at',
    'updated', case when src ->> 'state' = 'live' or admin
                 then to_jsonb((select max(pt.entered_at) from public.points pt join public.challenges ch on ch.id = pt.challenge_id and ch.event_id = ev))
                 else src -> 'taken_at' end,
    'top_n', s.leaderboard_top_n,
    'course_n', s.course_top_n,
    'students', jsonb_array_length(src -> 'individual'),
    'takeovers_shown', s.takeovers_shown,
    'course_max', (select sum(max_points) from public.grade_items where event_id = ev and course_id is null),
    'individual', (select coalesce(jsonb_agg(public.lb_slim(r, ids) order by ord), '[]')
                   from jsonb_array_elements(src -> 'individual') with ordinality as x(r, ord)
                   where admin or ord <= s.leaderboard_top_n),
    'teams', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                'name', t -> 'name', 'number', t -> 'number', 'counselors', t -> 'counselors',
                'takeovers', t -> 'takeovers',
                'takeovers_auto', case when admin then t -> 'takeovers_auto' end,
                'total', t -> 'total', 'rank', t -> 'rank',
                'points', (select coalesce(jsonb_agg(t -> 'challenges' -> (i #>> '{}') order by n), '[]')
                           from jsonb_array_elements(ids) with ordinality as y(i, n))))), '[]')
              from jsonb_array_elements(src -> 'teams') t),
    'courses', (select coalesce(jsonb_agg(jsonb_build_object(
                  'course_id', c -> 'course_id', 'name', c -> 'name',
                  'rows', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                              'username', r -> 'username', 'avatar', r -> 'avatar', 'score', r -> 'score', 'rank', r -> 'rank')) order by ord), '[]')
                           from jsonb_array_elements(c -> 'rows') with ordinality as y(r, ord) where ord <= s.course_top_n))), '[]')
                from jsonb_array_elements(src -> 'courses') c),
    'challenges', (select coalesce(jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'kind', ch.kind,
                     'individual_max', ch.individual_max, 'team_max', ch.team_max) order by ch.sort, ch.name), '[]')
                   from public.challenges ch where ch.event_id = ev and ch.visible)
  );
end $$;

-- The student view is the same for every student, so it's saved too, once
-- per saved copy (or frozen snapshot) and settings combination.
create table public.leaderboard_views (
  event_id uuid not null references public.events (id) on delete cascade,
  state text not null,
  stamp text not null,
  view jsonb not null,
  primary key (event_id, state)
);
alter table public.leaderboard_views enable row level security;
-- No policies: nobody reads this table directly.
revoke all on public.leaderboard_views from anon, authenticated;

-- A new frozen snapshot replaces the saved frozen view.
create or replace function public.clear_frozen_view() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.leaderboard_views where event_id = new.event_id and state <> 'live';
  return new;
end $$;
create trigger leaderboard_snapshots_clear_view after insert or update on public.leaderboard_snapshots
  for each row execute function public.clear_frozen_view();

create or replace function public.get_leaderboard()
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  ev uuid := public.current_event();
  src jsonb;
  me uuid := public.me();
  admin boolean := public.is_admin();
  s public.settings;
  v_stamp text;
  v jsonb;
  mine jsonb;
  ids jsonb;
begin
  if me is null then return null; end if;
  src := public.leaderboard_source(ev);
  if src is null or src ->> 'state' = 'hidden' and not admin then
    return jsonb_build_object('state', coalesce(src ->> 'state', 'hidden'));
  end if;
  if admin then
    return public.lb_view(src, ev, true);
  end if;

  select * into s from public.settings where event_id = ev;
  v_stamp := concat_ws('|', coalesce(src ->> 'stamp', src ->> 'taken_at'), s.leaderboard_top_n, s.course_top_n, s.takeovers_shown,
    (select md5(coalesce(string_agg(concat_ws(',', ch.id, ch.name, ch.kind, ch.individual_max, ch.team_max), ';' order by ch.sort, ch.name), ''))
     from public.challenges ch where ch.event_id = ev and ch.visible));
  select lv.view into v from public.leaderboard_views lv
    where lv.event_id = ev and lv.state = src ->> 'state' and lv.stamp = v_stamp;
  if v is null then
    v := public.lb_view(src, ev, false);
    insert into public.leaderboard_views (event_id, state, stamp, view)
    values (ev, src ->> 'state', v_stamp, v)
    on conflict (event_id, state) do update set stamp = excluded.stamp, view = excluded.view;
  end if;

  -- A student below the cutoff still sees their own row.
  select coalesce(jsonb_agg(ch.id order by ch.sort, ch.name), '[]') into ids
    from public.challenges ch where ch.event_id = ev and ch.visible;
  select public.lb_slim(r, ids) into mine
    from jsonb_array_elements(src -> 'individual') with ordinality as x(r, ord)
    where (r ->> 'person_id')::uuid = me and ord > s.leaderboard_top_n;
  return v || jsonb_build_object('me_below_cutoff', mine);
end $$;

-- Home's Your Standing card: same answer as before, from the saved copy.
create or replace function public.get_my_standing()
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  ev uuid := public.current_event();
  src jsonb;
  me uuid := public.me();
  row jsonb;
  team jsonb;
  rate numeric;
begin
  if me is null then return null; end if;
  src := public.leaderboard_source(ev);
  if src is null or src ->> 'state' = 'hidden' and not public.is_admin() then
    return jsonb_build_object('state', 'hidden');
  end if;
  select r into row from jsonb_array_elements(src -> 'individual') r where (r ->> 'person_id')::uuid = me;
  select t into team from jsonb_array_elements(src -> 'teams') t
    where exists (select 1 from public.team_members tm where tm.team_id = (t ->> 'team_id')::uuid and tm.person_id = me);
  select credits_per_point into rate from public.settings where event_id = ev;
  return jsonb_build_object(
    'state', src ->> 'state',
    'rank', row -> 'rank',
    'of', jsonb_array_length(src -> 'individual'),
    'total', row -> 'total',
    'credits', floor(coalesce((row ->> 'total')::numeric, 0) * rate),
    'team', team -> 'name',
    'team_rank', team -> 'rank'
  );
end $$;

-- A. Photos: 1 MB each at most, images only.
update storage.buckets set file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'avatars';

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.cached_leaderboard(uuid), public.lb_slim(jsonb, jsonb), public.lb_view(jsonb, uuid, boolean), public.clear_frozen_view() from authenticated;
grant execute on function public.get_leaderboard(), public.get_my_standing() to authenticated;
