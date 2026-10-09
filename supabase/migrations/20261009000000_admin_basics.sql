-- Phase 2: admin basics. Settings used by the admin pages, Home Page
-- Content, an activity log for the Overview, and helpers for accounts,
-- courses and grade items.

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
alter table public.settings
  add column last_day date,
  add column sessions_per_course int not null default 9 check (sessions_per_course between 1 and 60),
  add column courses_that_count int not null default 3 check (courses_that_count between 1 and 10);

-- ---------------------------------------------------------------------
-- Home Page Content: reminders keep an order; quick links
-- ---------------------------------------------------------------------
alter table public.reminders add column sort int not null default 0;

create table public.quick_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  label text not null,
  audience text not null default 'both' check (audience in ('students', 'instructors', 'both')),
  page text check (page in ('merchandise', 'learn', 'leaderboard', 'past-resources', 'courses')),
  url text,
  sort int not null default 0,
  constraint page_or_url check ((page is null) <> (url is null))
);
alter table public.quick_links enable row level security;
revoke all on public.quick_links from anon;
create policy "read quick links" on public.quick_links for select to authenticated using (public.has_account());
create policy "admins manage quick links" on public.quick_links for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Activity log for the Overview's Recent Activity (score edits come from
-- grade_edits). Admins only.
-- ---------------------------------------------------------------------
create table public.activity_log (
  id bigint generated always as identity primary key,
  event_id uuid references public.events (id) on delete cascade,
  actor_id uuid references public.people (id) on delete set null,
  action text not null,
  at timestamptz not null default now()
);
create index activity_log_at on public.activity_log (at desc);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon;
create policy "admins read activity" on public.activity_log for select to authenticated using (public.is_admin());

create or replace function public.log_points() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (event_id, actor_id, action)
  select ch.event_id, public.me(),
         'Entered points · ' || ch.name || ' · ' || case when bool_or(n.team_id is not null) then 'Teams' else 'Students' end
  from new_rows n join public.challenges ch on ch.id = n.challenge_id
  group by ch.event_id, ch.name;
  return null;
end $$;
create trigger points_log_insert after insert on public.points
  referencing new table as new_rows for each statement execute function public.log_points();
create trigger points_log_update after update on public.points
  referencing new table as new_rows for each statement execute function public.log_points();

create or replace function public.log_camp_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (event_id, actor_id, action) values (new.event_id, public.me(), 'Posted a Camp Update');
  return null;
end $$;
create trigger camp_updates_log after insert on public.camp_updates
  for each row execute function public.log_camp_update();

create or replace function public.log_leaderboard_state() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.leaderboard_state is distinct from old.leaderboard_state then
    insert into public.activity_log (event_id, actor_id, action)
    values (new.event_id, public.me(), case new.leaderboard_state
      when 'frozen' then 'Froze the leaderboard'
      when 'hidden' then 'Hid the leaderboard'
      else 'Made the leaderboard live' end);
  end if;
  return null;
end $$;
create trigger settings_log_state after update on public.settings
  for each row execute function public.log_leaderboard_state();

-- ---------------------------------------------------------------------
-- Course slots: the best K course scores; with fewer courses, one course
-- fills x0.75 then x0.50, two or more fill with their average.
-- ---------------------------------------------------------------------
create or replace function public.course_slots(p_names text[], p_scores numeric[], k int)
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  n int := coalesce(array_length(p_scores, 1), 0);
  out jsonb := '[]'::jsonb;
  fill numeric;
begin
  if n = 0 then return out; end if;
  for i in 1..least(n, k) loop
    out := out || jsonb_build_array(jsonb_build_object('ord', i, 'name', p_names[i], 'points', p_scores[i], 'extrapolated', false));
  end loop;
  for i in (n + 1)..k loop
    if n = 1 then
      fill := round(p_scores[1] * case when i = 2 then 0.75 when i = 3 then 0.50 else 0 end, 2);
    else
      select round(avg(x), 2) into fill from unnest(p_scores) x;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('ord', i, 'name', null, 'points', fill, 'extrapolated', true));
  end loop;
  return out;
end $$;

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
-- IDs for instructors and admins: course code (or the admin prefix),
-- 2-digit year, initials, then 2 digits. e.g. COA27AB01, ADM27AB01.
-- ---------------------------------------------------------------------
create or replace function public.next_person_code(p_prefix text, p_first text, p_last text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  yy text := lpad(((select year from public.events where is_current) % 100)::text, 2, '0');
  initials text := upper(left(regexp_replace(coalesce(p_first, ''), '[^A-Za-z]', '', 'g'), 1)
                      || left(regexp_replace(coalesce(p_last, ''), '[^A-Za-z]', '', 'g'), 1));
  base text;
  n int := 1;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  base := upper(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9]', '', 'g')) || coalesce(yy, '00') || initials;
  while exists (select 1 from public.people where person_code = base || lpad(n::text, 2, '0')) loop
    n := n + 1;
  end loop;
  return base || lpad(n::text, 2, '0');
end $$;

-- ---------------------------------------------------------------------
-- Sessions: every course in the current event has "sessions per course"
-- sessions. Extra sessions are only removed when nobody checked in.
-- ---------------------------------------------------------------------
create or replace function public.sync_sessions(p_course uuid default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  ev uuid := public.current_event();
  n int := (select sessions_per_course from public.settings where event_id = ev);
begin
  if n is null then return; end if;
  insert into public.sessions (course_id, number)
  select c.id, g from public.courses c, generate_series(1, n) g
  where c.event_id = ev and (p_course is null or c.id = p_course)
  on conflict (course_id, number) do nothing;
  delete from public.sessions s
  using public.courses c
  where c.id = s.course_id and c.event_id = ev and (p_course is null or c.id = p_course)
    and s.number > n and not exists (select 1 from public.attendance a where a.session_id = s.id);
end $$;

create or replace function public.course_sessions_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_sessions(new.id);
  return null;
end $$;
create trigger courses_sessions after insert on public.courses
  for each row execute function public.course_sessions_trigger();

create or replace function public.settings_sessions_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sessions_per_course is distinct from old.sessions_per_course then
    perform public.sync_sessions(null);
    -- Attendance max follows: points per session x sessions.
    update public.grade_items set max_points = points_per_session * new.sessions_per_course
    where event_id = new.event_id and kind = 'attendance';
  end if;
  return null;
end $$;
create trigger settings_sessions after update on public.settings
  for each row execute function public.settings_sessions_trigger();

-- ---------------------------------------------------------------------
-- Courses with students, scores or attendance are archived, not deleted.
-- ---------------------------------------------------------------------
create or replace function public.course_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.enrollments where course_id = old.id)
     or exists (select 1 from public.grades where course_id = old.id)
     or exists (select 1 from public.attendance a join public.sessions s on s.id = a.session_id where s.course_id = old.id) then
    raise exception 'This course has students or scores, so it can only be archived' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger courses_delete_guard before delete on public.courses
  for each row execute function public.course_delete_guard();

-- ---------------------------------------------------------------------
-- Course grade item overrides: start from a copy of the shared set; going
-- back to the shared set is refused once the course's own items have scores.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_course_override(p_course uuid, p_on boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare ev uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select event_id into ev from public.courses where id = p_course;
  if p_on then
    if not exists (select 1 from public.grade_items where course_id = p_course) then
      insert into public.grade_items (event_id, course_id, name, kind, max_points, points_per_session, sort)
      select event_id, p_course, name, kind, max_points, points_per_session, sort
      from public.grade_items where event_id = ev and course_id is null;
    end if;
  else
    if exists (select 1 from public.grades g join public.grade_items gi on gi.id = g.grade_item_id where gi.course_id = p_course) then
      raise exception 'This course already has scores on its own grade items' using errcode = '23503';
    end if;
    delete from public.grade_items where course_id = p_course;
  end if;
end $$;

-- Scores now above their item's maximum (after a maximum was lowered).
create or replace function public.admin_scores_over_max()
returns table (course text, student text, item text, points numeric, max_points numeric)
language sql stable security definer set search_path = '' as $$
  select c.name, p.first_name || ' ' || p.last_name, gi.name, g.points, gi.max_points
  from public.grades g
  join public.grade_items gi on gi.id = g.grade_item_id
  join public.courses c on c.id = g.course_id
  join public.people p on p.id = g.person_id
  where public.is_admin() and g.points > gi.max_points and c.event_id = public.current_event()
  order by c.name, p.last_name
$$;

-- The trigger refuses scores above the maximum, so lowering a maximum
-- below existing scores is allowed (and then listed above).
-- ---------------------------------------------------------------------
-- Overview numbers, things that need attention, and recent activity.
-- ---------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ev uuid := public.current_event();
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'students', (select count(distinct e.person_id) from public.enrollments e join public.courses c on c.id = e.course_id and c.event_id = ev and not c.archived),
    'students_signed_up', (select count(distinct e.person_id) from public.enrollments e join public.courses c on c.id = e.course_id and c.event_id = ev and not c.archived
                           join public.people p on p.id = e.person_id where p.auth_user_id is not null),
    'instructors', (select count(distinct cs.person_id) from public.course_staff cs join public.courses c on c.id = cs.course_id and c.event_id = ev and not c.archived),
    'instructors_signed_up', (select count(distinct cs.person_id) from public.course_staff cs join public.courses c on c.id = cs.course_id and c.event_id = ev and not c.archived
                              join public.people p on p.id = cs.person_id where p.auth_user_id is not null),
    'courses', (select count(*) from public.courses where event_id = ev and not archived),
    'leaderboard_state', (select leaderboard_state from public.settings where event_id = ev),
    'leaderboard_updated', (select max(pt.entered_at) from public.points pt join public.challenges ch on ch.id = pt.challenge_id and ch.event_id = ev),
    'first_day', (select first_day from public.settings where event_id = ev),
    'missing_scores', (
      select coalesce(jsonb_agg(jsonb_build_object('item', x.item, 'courses', x.n) order by x.sort), '[]')
      from (
        select gi.name as item, gi.sort, count(*) as n
        from public.courses c
        join public.grade_items gi on gi.event_id = ev and gi.course_id is null and gi.kind = 'manual' and gi.name in ('Midpoint', 'Final')
        where c.event_id = ev and not c.archived
          and not exists (select 1 from public.grades g join public.grade_items gi2 on gi2.id = g.grade_item_id
                          where g.course_id = c.id and gi2.name = gi.name)
        group by gi.name, gi.sort
      ) x),
    'feedback_missing', (
      select coalesce(jsonb_agg(k), '[]') from unnest(array['midpoint', 'final']::public.feedback_kind[]) k
      where not exists (select 1 from public.feedback_results f join public.courses c on c.id = f.course_id where c.event_id = ev and f.kind = k)),
    'activity', (
      select coalesce(jsonb_agg(a order by a.at desc), '[]') from (
        select * from (
          select coalesce(p.first_name || ' ' || p.last_name, 'Campus') as who, al.at,
                 al.action as what
          from public.activity_log al left join public.people p on p.id = al.actor_id
          where al.event_id = ev
          union all
          select coalesce(p.first_name || ' ' || p.last_name, 'Campus'), ge.edited_at,
                 c.name || ' · ' || s.first_name || ' ' || s.last_name || ' · ' || gi.name || ': '
                   || coalesce(trim(trailing '.' from trim(trailing '0' from ge.old_points::text)), '—') || ' → '
                   || coalesce(trim(trailing '.' from trim(trailing '0' from ge.new_points::text)), '—')
          from public.grade_edits ge
          join public.courses c on c.id = ge.course_id and c.event_id = ev
          join public.people s on s.id = ge.person_id
          join public.grade_items gi on gi.id = ge.grade_item_id
          left join public.people p on p.id = ge.edited_by
        ) u order by at desc limit 6
      ) a)
  ) into result;
  return result;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.log_points, public.log_camp_update, public.log_leaderboard_state,
  public.course_sessions_trigger, public.settings_sessions_trigger, public.course_delete_guard,
  public.sync_sessions(uuid) from authenticated;
grant execute on function public.next_person_code, public.admin_set_course_override, public.admin_scores_over_max,
  public.admin_overview, public.course_slots to authenticated;
