-- Scores, totals and leaderboards, calculated by the database.
-- See "Leaderboard" in the planning doc.

-- ---------------------------------------------------------------------
-- Course scores: grade items (the event's shared set, or the course's own
-- set if admins overrode it) plus attendance points from check-ins.
-- Internal: not callable from the browser.
-- ---------------------------------------------------------------------
create or replace function public.course_scores(p_event uuid)
returns table (course_id uuid, person_id uuid, score numeric)
language sql stable security definer set search_path = '' as $$
  with items as (
    select c.id as course_id, gi.id, gi.kind, gi.max_points, gi.points_per_session
    from public.courses c
    join public.grade_items gi on gi.event_id = c.event_id
      and (gi.course_id = c.id
           or (gi.course_id is null and not exists (select 1 from public.grade_items o where o.course_id = c.id)))
    where c.event_id = p_event
  ),
  att as (
    select s.course_id, a.person_id, count(*) as n
    from public.attendance a join public.sessions s on s.id = a.session_id
    group by 1, 2
  )
  select e.course_id, e.person_id,
    coalesce((select sum(g.points) from public.grades g
              join items i on i.id = g.grade_item_id and i.course_id = g.course_id and i.kind = 'manual'
              where g.course_id = e.course_id and g.person_id = e.person_id), 0)
    + coalesce((select sum(least(i.max_points, i.points_per_session * coalesce(att.n, 0)))
                from items i left join att on att.course_id = i.course_id and att.person_id = e.person_id
                where i.course_id = e.course_id and i.kind = 'attendance'), 0)
  from public.enrollments e
  join public.courses c on c.id = e.course_id and c.event_id = p_event
$$;

-- ---------------------------------------------------------------------
-- The full leaderboard for an event, as JSON. Internal.
--   individual: every student, ranked
--   teams:      every team, ranked
--   courses:    every course with its students ranked by course score
-- ---------------------------------------------------------------------
create or replace function public.compute_leaderboard(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  with scores as (
    select * from public.course_scores(p_event)
  ),
  students as (
    select distinct p.id, p.username
    from public.people p
    where p.role = 'student' and (
      exists (select 1 from public.enrollments e join public.courses c on c.id = e.course_id
              where e.person_id = p.id and c.event_id = p_event)
      or exists (select 1 from public.team_members tm where tm.person_id = p.id and tm.event_id = p_event))
  ),
  ranked_courses as (
    select s.person_id, s.course_id, s.score,
      row_number() over (partition by s.person_id order by s.score desc, c.name) as pos,
      count(*) over (partition by s.person_id) as n, c.name
    from scores s join public.courses c on c.id = s.course_id
  ),
  -- Top three course scores, filling gaps with the extrapolation rule.
  top3 as (
    select st.id as person_id,
      (select jsonb_agg(x order by x.ord) from (
        select 1 as ord, rc.name, rc.score as points, false as extrapolated from ranked_courses rc where rc.person_id = st.id and rc.pos = 1
        union all
        select 2, rc.name, rc.score, false from ranked_courses rc where rc.person_id = st.id and rc.pos = 2
        union all
        select 3, rc.name, rc.score, false from ranked_courses rc where rc.person_id = st.id and rc.pos = 3
        union all
        -- one course: second = x0.75, third = x0.50
        select 2, null, round(rc.score * 0.75, 2), true from ranked_courses rc where rc.person_id = st.id and rc.n = 1
        union all
        select 3, null, round(rc.score * 0.50, 2), true from ranked_courses rc where rc.person_id = st.id and rc.n = 1
        union all
        -- two courses: third = average of the two
        select 3, null, round(avg(rc.score), 2), true from ranked_courses rc where rc.person_id = st.id and rc.n = 2 group by rc.person_id
      ) x) as courses
    from students st
  ),
  challenge_pts as (
    select pt.person_id, jsonb_object_agg(ch.id, pt.points) as by_challenge, sum(pt.points) as total
    from public.points pt
    join public.challenges ch on ch.id = pt.challenge_id and ch.event_id = p_event and ch.visible
    where pt.person_id is not null
    group by pt.person_id
  ),
  teams_of as (
    select tm.person_id, t.id as team_id, t.name as team_name
    from public.team_members tm join public.teams t on t.id = tm.team_id
    where tm.event_id = p_event
  ),
  indiv as (
    select st.id as person_id, st.username, tof.team_name,
      coalesce(t3.courses, '[]'::jsonb) as courses,
      coalesce(cp.by_challenge, '{}'::jsonb) as challenges,
      coalesce((select sum((c ->> 'points')::numeric) from jsonb_array_elements(t3.courses) c), 0)
        + coalesce(cp.total, 0) as total
    from students st
    left join top3 t3 on t3.person_id = st.id
    left join challenge_pts cp on cp.person_id = st.id
    left join teams_of tof on tof.person_id = st.id
  ),
  indiv_ranked as (
    select i.*, rank() over (order by i.total desc) as rank from indiv i
  ),
  -- Course takeover: the top scorer(s) in each course earn their team the bonus.
  course_tops as (
    select s.course_id, s.person_id
    from (select sc.*, rank() over (partition by sc.course_id order by sc.score desc) as r from scores sc where sc.score > 0) s
    where s.r = 1
  ),
  takeovers as (
    select tof.team_id, count(*) * (select takeover_bonus from public.settings where event_id = p_event) as bonus
    from course_tops ct join teams_of tof on tof.person_id = ct.person_id
    group by tof.team_id
  ),
  team_pts as (
    select pt.team_id, jsonb_object_agg(ch.id, pt.points) as by_challenge, sum(pt.points) as total
    from public.points pt
    join public.challenges ch on ch.id = pt.challenge_id and ch.event_id = p_event and ch.visible
    where pt.team_id is not null
    group by pt.team_id
  ),
  team_rows as (
    select t.id as team_id, t.name, t.number, t.counselors,
      tk.bonus as takeovers,
      coalesce(tp.by_challenge, '{}'::jsonb) as challenges,
      coalesce(tk.bonus, 0) + coalesce(tp.total, 0) as total
    from public.teams t
    left join takeovers tk on tk.team_id = t.id
    left join team_pts tp on tp.team_id = t.id
    where t.event_id = p_event
  ),
  course_lists as (
    select c.id as course_id, c.name, c.sort,
      coalesce((select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'username', p.username, 'score', r.score, 'rank', r.rank) order by r.rank, p.username)
                from (select sc.person_id, sc.score, rank() over (order by sc.score desc) as rank from scores sc where sc.course_id = c.id) r
                join public.people p on p.id = r.person_id), '[]'::jsonb) as rows
    from public.courses c
    where c.event_id = p_event and not c.archived
  )
  select jsonb_build_object(
    'individual', coalesce((select jsonb_agg(jsonb_build_object(
        'person_id', ir.person_id, 'username', ir.username, 'team', ir.team_name, 'courses', ir.courses,
        'challenges', ir.challenges, 'total', ir.total, 'rank', ir.rank) order by ir.rank, ir.username) from indiv_ranked ir), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'team_id', tr.team_id, 'name', tr.name, 'number', tr.number, 'counselors', tr.counselors,
        'takeovers', tr.takeovers, 'challenges', tr.challenges, 'total', tr.total, 'rank', tr.rank) order by tr.rank, tr.name)
        from (select x.*, rank() over (order by x.total desc) as rank from team_rows x) tr), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('course_id', cl.course_id, 'name', cl.name, 'rows', cl.rows) order by cl.sort, cl.name)
        from course_lists cl), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------
-- Snapshots: freezing (or hiding) publishes nothing new to students;
-- the standings at that moment are kept and shown instead.
-- ---------------------------------------------------------------------
create or replace function public.snapshot_on_freeze() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lb jsonb;
begin
  if new.leaderboard_state <> 'live' and old.leaderboard_state = 'live' then
    lb := public.compute_leaderboard(new.event_id);
    insert into public.leaderboard_snapshots (event_id, taken_at, individual, teams, courses)
    values (new.event_id, now(), lb -> 'individual', lb -> 'teams', lb -> 'courses')
    on conflict (event_id) do update
      set taken_at = excluded.taken_at, individual = excluded.individual, teams = excluded.teams, courses = excluded.courses;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger settings_snapshot before update on public.settings
  for each row execute function public.snapshot_on_freeze();

-- The data a given viewer should see: live for admins and while live,
-- the snapshot while frozen, nothing while hidden.
create or replace function public.leaderboard_source(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.leaderboard_state;
  snap public.leaderboard_snapshots;
begin
  select leaderboard_state into st from public.settings where event_id = p_event;
  if st is null then return null; end if;
  if public.is_admin() or st = 'live' then
    return public.compute_leaderboard(p_event) || jsonb_build_object('state', st);
  end if;
  if st = 'hidden' then
    return jsonb_build_object('state', st);
  end if;
  select * into snap from public.leaderboard_snapshots where event_id = p_event;
  return jsonb_build_object('state', st, 'individual', coalesce(snap.individual, '[]'), 'teams', coalesce(snap.teams, '[]'),
                            'courses', coalesce(snap.courses, '[]'), 'taken_at', snap.taken_at);
end $$;

-- ---------------------------------------------------------------------
-- Browser-facing functions. Usernames only, never real names.
-- ---------------------------------------------------------------------
create or replace function public.get_leaderboard()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ev uuid := public.current_event();
  src jsonb;
  top_n int;
  course_n int;
  me uuid := public.me();
  admin boolean := public.is_admin();
  indiv jsonb;
  mine jsonb;
begin
  if me is null then return null; end if;
  src := public.leaderboard_source(ev);
  if src is null or src ->> 'state' = 'hidden' and not admin then
    return jsonb_build_object('state', coalesce(src ->> 'state', 'hidden'));
  end if;
  select leaderboard_top_n, course_top_n into top_n, course_n from public.settings where event_id = ev;

  select coalesce(jsonb_agg((r - 'person_id') || jsonb_build_object('is_me', (r ->> 'person_id')::uuid = me) order by ord), '[]')
    into indiv
    from jsonb_array_elements(src -> 'individual') with ordinality as x(r, ord)
    where admin or ord <= top_n;

  -- A student below the cutoff still sees their own row.
  if not admin then
    select (r - 'person_id') || jsonb_build_object('is_me', true) into mine
      from jsonb_array_elements(src -> 'individual') with ordinality as x(r, ord)
      where (r ->> 'person_id')::uuid = me and ord > top_n;
  end if;

  return jsonb_build_object(
    'state', src ->> 'state',
    'taken_at', src -> 'taken_at',
    'top_n', top_n,
    'individual', indiv,
    'me_below_cutoff', mine,
    'teams', (select coalesce(jsonb_agg((t - 'team_id') || jsonb_build_object('is_mine', exists (
                select 1 from public.team_members tm where tm.team_id = (t ->> 'team_id')::uuid and tm.person_id = me))), '[]')
              from jsonb_array_elements(src -> 'teams') t),
    'courses', (select coalesce(jsonb_agg(jsonb_build_object(
                  'course_id', c -> 'course_id', 'name', c -> 'name',
                  'rows', (select coalesce(jsonb_agg((r - 'person_id') || jsonb_build_object('is_me', (r ->> 'person_id')::uuid = me) order by ord), '[]')
                           from jsonb_array_elements(c -> 'rows') with ordinality as y(r, ord) where admin or ord <= course_n))), '[]')
                from jsonb_array_elements(src -> 'courses') c),
    'challenges', (select coalesce(jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'kind', ch.kind,
                     'individual_max', ch.individual_max, 'team_max', ch.team_max) order by ch.sort, ch.name), '[]')
                   from public.challenges ch where ch.event_id = ev and ch.visible)
  );
end $$;

-- Home "Your Standing": camp rank out of every student, whatever the cutoff.
create or replace function public.get_my_standing()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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

-- Signed-out visitors can't call any function; internal ones are for the
-- database only.
revoke execute on all functions in schema public from public, anon;
revoke execute on function public.course_scores, public.compute_leaderboard, public.leaderboard_source,
  public.snapshot_on_freeze from authenticated;
grant execute on function public.get_leaderboard, public.get_my_standing to authenticated;
