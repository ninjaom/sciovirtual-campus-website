-- Phase 2 follow-ups (Om's answers, Oct 8):
--   * GTKY form: a true/false per student, set by importing Student IDs.
--   * Leaderboards leave out students who haven't signed up yet; their
--     scores still count toward course takeovers for their team.
--   * Reminders are always urgent, so the unused flag is removed.
--   * Deleting an account is a database-only command (SQL Editor).

-- ---------------------------------------------------------------------
-- GTKY
-- ---------------------------------------------------------------------
alter table public.people add column gtky_done boolean not null default false;
alter table public.settings add column gtky_imported_at timestamptz;

-- Students can't change their own GTKY value (or anything but their photo
-- and recovery email).
create or replace function public.people_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  if (new.id, new.auth_user_id, new.person_code, new.role, new.first_name, new.last_name, new.username,
      new.grade, new.school, new.city, new.state, new.student_email, new.parent_email, new.email, new.signed_up_at,
      new.gtky_done)
     is distinct from
     (old.id, old.auth_user_id, old.person_code, old.role, old.first_name, old.last_name, old.username,
      old.grade, old.school, old.city, old.state, old.student_email, old.parent_email, old.email, old.signed_up_at,
      old.gtky_done) then
    raise exception 'Only your photo and recovery email can be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- Marks every listed Student ID as having filled out the GTKY form.
-- Adds to earlier imports; never un-marks anyone.
create or replace function public.admin_import_gtky(p_codes text[])
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  ev uuid := public.current_event();
  marked int;
  unknown text[];
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct upper(trim(c))), '{}') into unknown
    from unnest(p_codes) c
    where trim(c) <> '' and not exists (
      select 1 from public.people p where upper(p.person_code::text) = upper(trim(c)) and p.role = 'student');
  update public.people p set gtky_done = true
    where p.role = 'student' and not p.gtky_done
      and upper(p.person_code::text) in (select upper(trim(c)) from unnest(p_codes) c where trim(c) <> '');
  get diagnostics marked = row_count;
  update public.settings set gtky_imported_at = now() where event_id = ev;
  insert into public.activity_log (event_id, actor_id, action)
    values (ev, public.me(), 'Imported GTKY form · ' || marked || ' new');
  return jsonb_build_object('marked', marked, 'unknown', to_jsonb(unknown));
end $$;

-- ---------------------------------------------------------------------
-- Leaderboards: only students who have signed up (they have a username).
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
  -- Shown on leaderboards: signed-up students only.
  students as (
    select distinct p.id, p.username
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
      coalesce((select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'username', r.username, 'score', r.score, 'rank', r.rank) order by r.rank, r.username)
                from (select sc.person_id, p.username, sc.score, rank() over (order by sc.score desc) as rank
                      from scores sc join public.people p on p.id = sc.person_id and p.username is not null
                      where sc.course_id = c.id) r), '[]'::jsonb) as rows
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
-- Reminders are always urgent.
-- ---------------------------------------------------------------------
alter table public.reminders drop column urgent;

-- ---------------------------------------------------------------------
-- Overview: GTKY count (shown once the form has been imported).
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
    'gtky_missing', case when (select gtky_imported_at from public.settings where event_id = ev) is null then null else
      (select count(distinct e.person_id) from public.enrollments e join public.courses c on c.id = e.course_id and c.event_id = ev and not c.archived
       join public.people p on p.id = e.person_id where not p.gtky_done) end,
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

-- ---------------------------------------------------------------------
-- Deleting an account: SQL Editor only, never from the website.
--   select public.delete_person('27AA0001');
-- Removes the person, everything tied to them (scores, enrollments,
-- check-ins, points, team spot, setup codes) and their sign-in.
-- Their profile photo, if any, is removed in Storage by hand.
-- ---------------------------------------------------------------------
create or replace function public.delete_person(p_code text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  target public.people;
begin
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Only from the Supabase SQL Editor' using errcode = '42501';
  end if;
  select * into target from public.people where upper(person_code::text) = upper(trim(p_code));
  if target.id is null then
    raise exception 'No account with ID %', p_code;
  end if;
  delete from public.people where id = target.id;
  if target.auth_user_id is not null then
    delete from auth.users where id = target.auth_user_id;
  end if;
  return 'Deleted ' || target.person_code || ' (' || target.first_name || ' ' || target.last_name || ')'
    || case when target.avatar_path is not null then '. Also delete their photo in Storage > avatars: ' || target.avatar_path else '' end;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.delete_person(text), public.compute_leaderboard(uuid) from authenticated;
grant execute on function public.admin_import_gtky(text[]), public.admin_overview() to authenticated;
