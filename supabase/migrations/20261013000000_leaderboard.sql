-- Phase 5: leaderboard.
--   * Points can't be negative or above the event's maximum.
--   * Course takeovers stay calculated, with a per-team override for admins,
--     and the Course Takeovers column can be hidden like any event.
--   * Leaderboards carry each student's photo (never real names).
--   * Course leaderboards show the top 10 by default (editable).

alter table public.points add constraint points_not_negative check (points >= 0);

create or replace function public.points_max_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  lim numeric;
begin
  select case when new.person_id is not null then individual_max else team_max end into lim
  from public.challenges where id = new.challenge_id;
  if lim is not null and new.points > lim then
    raise exception 'Points are above the maximum for this event' using errcode = '22003';
  end if;
  return new;
end $$;
create trigger points_max before insert or update on public.points
  for each row execute function public.points_max_guard();

alter table public.teams add column takeover_override numeric check (takeover_override >= 0);
alter table public.settings add column takeovers_shown boolean not null default true;
alter table public.settings alter column course_top_n set default 10;

create or replace function public.compute_leaderboard(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  with scores as (
    select * from public.course_scores(p_event)
  ),
  -- Shown on leaderboards: signed-up students only.
  students as (
    select distinct p.id, p.username, p.avatar_path
    from public.people p
    where p.role = 'student' and p.username is not null and (
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
  -- Best course scores ("courses that count", 3 by default), filling gaps
  -- with the extrapolation rule.
  top3 as (
    select st.id as person_id,
      public.course_slots(
        (select array_agg(rc.name order by rc.pos) from ranked_courses rc where rc.person_id = st.id),
        (select array_agg(rc.score order by rc.pos) from ranked_courses rc where rc.person_id = st.id),
        coalesce((select courses_that_count from public.settings where event_id = p_event), 3)
      ) as courses
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
    select st.id as person_id, st.username, st.avatar_path, tof.team_name,
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
  -- Course takeover: the top scorer(s) in each course earn their team the
  -- bonus, whether or not they have signed up yet.
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
  -- Takeovers are calculated, but an admin can set a team's amount by hand;
  -- hiding the Course Takeovers column leaves them out of totals.
  shown as (
    select coalesce((select takeovers_shown from public.settings where event_id = p_event), true) as is_on
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
      coalesce(t.takeover_override, tk.bonus) as takeovers,
      tk.bonus as takeovers_auto,
      coalesce(tp.by_challenge, '{}'::jsonb) as challenges,
      case when (select is_on from shown) then coalesce(t.takeover_override, tk.bonus, 0) else 0 end + coalesce(tp.total, 0) as total
    from public.teams t
    left join takeovers tk on tk.team_id = t.id
    left join team_pts tp on tp.team_id = t.id
    where t.event_id = p_event
  ),
  course_lists as (
    select c.id as course_id, c.name, c.sort,
      coalesce((select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'username', r.username, 'avatar', r.avatar_path, 'score', r.score, 'rank', r.rank) order by r.rank, r.username)
                from (select sc.person_id, p.username, p.avatar_path, sc.score, rank() over (order by sc.score desc) as rank
                      from scores sc join public.people p on p.id = sc.person_id and p.username is not null
                      where sc.course_id = c.id) r), '[]'::jsonb) as rows
    from public.courses c
    where c.event_id = p_event and not c.archived
  )
  select jsonb_build_object(
    'individual', coalesce((select jsonb_agg(jsonb_build_object(
        'person_id', ir.person_id, 'username', ir.username, 'avatar', ir.avatar_path, 'team', ir.team_name, 'courses', ir.courses,
        'challenges', ir.challenges, 'total', ir.total, 'rank', ir.rank) order by ir.rank, ir.username) from indiv_ranked ir), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'team_id', tr.team_id, 'name', tr.name, 'number', tr.number, 'counselors', tr.counselors,
        'takeovers', tr.takeovers, 'takeovers_auto', tr.takeovers_auto, 'challenges', tr.challenges, 'total', tr.total, 'rank', tr.rank) order by tr.rank, tr.name)
        from (select x.*, rank() over (order by x.total desc) as rank from team_rows x) tr), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('course_id', cl.course_id, 'name', cl.name, 'rows', cl.rows) order by cl.sort, cl.name)
        from course_lists cl), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------
-- What students see: unchanged rules, plus the photo, the course cutoff,
-- when points were last entered and whether takeovers are shown.
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
  s public.settings;
begin
  if me is null then return null; end if;
  src := public.leaderboard_source(ev);
  if src is null or src ->> 'state' = 'hidden' and not admin then
    return jsonb_build_object('state', coalesce(src ->> 'state', 'hidden'));
  end if;
  select * into s from public.settings where event_id = ev;
  top_n := s.leaderboard_top_n;
  course_n := s.course_top_n;

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
    'updated', case when src ->> 'state' = 'live' or admin
                 then to_jsonb((select max(pt.entered_at) from public.points pt join public.challenges ch on ch.id = pt.challenge_id and ch.event_id = ev))
                 else src -> 'taken_at' end,
    'top_n', top_n,
    'course_n', course_n,
    'students', jsonb_array_length(src -> 'individual'),
    'takeovers_shown', s.takeovers_shown,
    'course_max', (select sum(max_points) from public.grade_items where event_id = ev and course_id is null),
    'individual', indiv,
    'me_below_cutoff', mine,
    'teams', (select coalesce(jsonb_agg((t - 'team_id' - case when admin then '' else 'takeovers_auto' end) || jsonb_build_object('is_mine', exists (
                select 1 from public.team_members tm where tm.team_id = (t ->> 'team_id')::uuid and tm.person_id = me))), '[]')
              from jsonb_array_elements(src -> 'teams') t),
    'courses', (select coalesce(jsonb_agg(jsonb_build_object(
                  'course_id', c -> 'course_id', 'name', c -> 'name',
                  'rows', (select coalesce(jsonb_agg((r - 'person_id') || jsonb_build_object('is_me', (r ->> 'person_id')::uuid = me) order by ord), '[]')
                           from jsonb_array_elements(c -> 'rows') with ordinality as y(r, ord) where ord <= course_n))), '[]')
                from jsonb_array_elements(src -> 'courses') c),
    'challenges', (select coalesce(jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'kind', ch.kind,
                     'individual_max', ch.individual_max, 'team_max', ch.team_max) order by ch.sort, ch.name), '[]')
                   from public.challenges ch where ch.event_id = ev and ch.visible)
  );
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.points_max_guard(), public.compute_leaderboard(uuid) from authenticated;
grant execute on function public.get_leaderboard() to authenticated;
