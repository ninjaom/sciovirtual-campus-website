-- Who can see and change what. See "Roles and permissions" in the planning doc.
-- Every rule here has an automated test in supabase/tests.

-- ---------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can look things up without
-- tripping over the rules they help define. They only ever answer
-- questions about the signed-in person.
-- ---------------------------------------------------------------------
create or replace function public.me() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.people where auth_user_id = auth.uid()
$$;

create or replace function public.my_role() returns public.role
language sql stable security definer set search_path = '' as $$
  select role from public.people where auth_user_id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.people where auth_user_id = auth.uid()), false)
$$;

create or replace function public.teaches(p_course uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.course_staff cs
    join public.people p on p.id = cs.person_id
    where cs.course_id = p_course and p.auth_user_id = auth.uid()
  )
$$;

create or replace function public.enrolled_in(p_course uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.enrollments e
    join public.people p on p.id = e.person_id
    where e.course_id = p_course and p.auth_user_id = auth.uid()
  )
$$;

-- Staff or admin for a course (instructor pages).
create or replace function public.can_manage_course(p_course uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.teaches(p_course)
$$;

-- Anyone who belongs to a course: its students, its staff, admins.
create or replace function public.in_course(p_course uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.teaches(p_course) or public.enrolled_in(p_course)
$$;

-- Does the signed-in person teach a course that this student takes,
-- or co-teach with this instructor?
create or replace function public.teaches_person(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.course_staff mine
    join public.people p on p.id = mine.person_id and p.auth_user_id = auth.uid()
    where exists (select 1 from public.enrollments e where e.course_id = mine.course_id and e.person_id = p_person)
       or exists (select 1 from public.course_staff cs where cs.course_id = mine.course_id and cs.person_id = p_person)
  )
$$;

create or replace function public.current_event() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.events where is_current
$$;

-- ---------------------------------------------------------------------
-- No access at all for signed-out visitors. Sign-up and password reset
-- go through server functions instead.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;
grant execute on function public.me, public.my_role, public.is_admin, public.teaches, public.enrolled_in,
  public.can_manage_course, public.in_course, public.teaches_person, public.current_event to authenticated;

-- ---------------------------------------------------------------------
-- events, settings
-- ---------------------------------------------------------------------
create policy "read events" on public.events for select to authenticated using (true);
create policy "admins manage events" on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read settings" on public.settings for select to authenticated using (true);
create policy "admins manage settings" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------
create policy "read own, taught, or all for admins" on public.people for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin() or public.teaches_person(id));
create policy "update own row" on public.people for update to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy "admins manage people" on public.people for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- People can only change their own photo and recovery email; everything
-- else (names, ID, role, username) is admin-only.
-- Runs as the person making the change (not security definer), so
-- current_user tells us who is acting.
create or replace function public.people_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  if (new.id, new.auth_user_id, new.person_code, new.role, new.first_name, new.last_name, new.username,
      new.grade, new.school, new.city, new.state, new.student_email, new.parent_email, new.email, new.signed_up_at)
     is distinct from
     (old.id, old.auth_user_id, old.person_code, old.role, old.first_name, old.last_name, old.username,
      old.grade, old.school, old.city, old.state, old.student_email, old.parent_email, old.email, old.signed_up_at) then
    raise exception 'Only your photo and recovery email can be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger people_guard before update on public.people for each row execute function public.people_guard();

-- Names and pictures other people may see (never emails or roster details):
-- all staff; students to themselves, their classmates and their courses' staff.
create or replace view public.people_directory with (security_barrier = true) as
  select p.id, p.first_name, p.last_name, p.role, p.username, p.avatar_path
  from public.people p
  where auth.uid() is not null and (
    p.role <> 'student'
    or p.auth_user_id = auth.uid()
    or public.is_admin()
    or public.teaches_person(p.id)
    or exists (
      select 1 from public.enrollments mine
      join public.enrollments theirs on theirs.course_id = mine.course_id
      where mine.person_id = public.me() and theirs.person_id = p.id
    )
  );
revoke all on public.people_directory from anon;
grant select on public.people_directory to authenticated;

-- ---------------------------------------------------------------------
-- setup codes and sign-up attempts: admins only (server functions use
-- the service role).
-- ---------------------------------------------------------------------
create policy "admins manage setup codes" on public.setup_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- signup_attempts: no policies, so only the service role can touch it.

-- ---------------------------------------------------------------------
-- courses and their people
-- ---------------------------------------------------------------------
create policy "read own courses" on public.courses for select to authenticated using (public.in_course(id));
create policy "admins manage courses" on public.courses for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "staff read zoom host" on public.course_zoom_hosts for select to authenticated using (public.can_manage_course(course_id));
create policy "admins manage zoom host" on public.course_zoom_hosts for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read course staff" on public.course_staff for select to authenticated using (public.in_course(course_id));
create policy "admins manage course staff" on public.course_staff for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read enrollments" on public.enrollments for select to authenticated
  using (person_id = public.me() or public.can_manage_course(course_id));
create policy "admins manage enrollments" on public.enrollments for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------
create policy "read teams" on public.teams for select to authenticated using (true);
create policy "admins manage teams" on public.teams for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read own team membership" on public.team_members for select to authenticated
  using (person_id = public.me() or public.is_admin());
create policy "admins manage team members" on public.team_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- sessions and attendance
-- ---------------------------------------------------------------------
create policy "read sessions" on public.sessions for select to authenticated using (public.in_course(course_id));
create policy "admins manage sessions" on public.sessions for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "staff read attendance codes" on public.attendance_codes for select to authenticated
  using (public.can_manage_course((select course_id from public.sessions s where s.id = session_id)));
create policy "admins manage attendance codes" on public.attendance_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read own or taught attendance" on public.attendance for select to authenticated
  using (person_id = public.me() or public.can_manage_course((select course_id from public.sessions s where s.id = session_id)));
create policy "admins manage attendance" on public.attendance for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- grades
-- ---------------------------------------------------------------------
create policy "read grade items" on public.grade_items for select to authenticated using (true);
create policy "admins manage grade items" on public.grade_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read own or taught grades" on public.grades for select to authenticated
  using (person_id = public.me() or public.can_manage_course(course_id));
create policy "staff enter grades" on public.grades for insert to authenticated
  with check (public.can_manage_course(course_id) and exists (select 1 from public.enrollments e where e.course_id = grades.course_id and e.person_id = grades.person_id));
create policy "staff change grades" on public.grades for update to authenticated
  using (public.can_manage_course(course_id))
  with check (public.can_manage_course(course_id) and exists (select 1 from public.enrollments e where e.course_id = grades.course_id and e.person_id = grades.person_id));
create policy "staff clear grades" on public.grades for delete to authenticated using (public.can_manage_course(course_id));

create policy "staff read edit log" on public.grade_edits for select to authenticated using (public.can_manage_course(course_id));
-- Edit log rows are only written by the trigger below.

create or replace function public.log_grade_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.grade_edits (course_id, person_id, grade_item_id, old_points, new_points, edited_by)
    values (old.course_id, old.person_id, old.grade_item_id, old.points, null, public.me());
    return old;
  end if;
  -- Scores can't be above the item's maximum.
  if new.points > (select max_points from public.grade_items gi where gi.id = new.grade_item_id) then
    raise exception 'Score is above the maximum for this item' using errcode = '22003';
  end if;
  if (select kind from public.grade_items gi where gi.id = new.grade_item_id) = 'attendance' then
    raise exception 'Attendance points are calculated, not entered' using errcode = '42501';
  end if;
  new.updated_by := public.me();
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.points is not distinct from old.points then
    return new;
  end if;
  insert into public.grade_edits (course_id, person_id, grade_item_id, old_points, new_points, edited_by)
  values (new.course_id, new.person_id, new.grade_item_id, case when tg_op = 'UPDATE' then old.points end, new.points, public.me());
  return new;
end $$;
create trigger grades_log before insert or update or delete on public.grades
  for each row execute function public.log_grade_edit();

-- ---------------------------------------------------------------------
-- leaderboard: points and challenges (students read results only
-- through the leaderboard functions)
-- ---------------------------------------------------------------------
create policy "read visible challenges" on public.challenges for select to authenticated using (visible or public.is_admin());
create policy "admins manage challenges" on public.challenges for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admins manage points" on public.points for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read snapshots" on public.leaderboard_snapshots for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- announcements and comments
-- ---------------------------------------------------------------------
create policy "course members read announcements" on public.announcements for select to authenticated using (public.in_course(course_id));
create policy "staff post announcements" on public.announcements for insert to authenticated
  with check (public.can_manage_course(course_id) and author_id = public.me());
create policy "authors and admins edit announcements" on public.announcements for update to authenticated
  using (author_id = public.me() or public.is_admin()) with check (public.can_manage_course(course_id));
create policy "authors and admins delete announcements" on public.announcements for delete to authenticated
  using (author_id = public.me() or public.is_admin());

create or replace function public.announcement_course(p_announcement uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select course_id from public.announcements where id = p_announcement
$$;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.announcement_course to authenticated;

create policy "course members read comments" on public.announcement_comments for select to authenticated
  using (public.in_course(public.announcement_course(announcement_id)));
create policy "course members comment" on public.announcement_comments for insert to authenticated
  with check (author_id = public.me() and public.in_course(public.announcement_course(announcement_id)));
create policy "authors edit comments" on public.announcement_comments for update to authenticated
  using (author_id = public.me()) with check (author_id = public.me());
create policy "authors and course staff remove comments" on public.announcement_comments for delete to authenticated
  using (author_id = public.me() or public.can_manage_course(public.announcement_course(announcement_id)));

-- ---------------------------------------------------------------------
-- Home: camp updates (everyone) and reminders (instructors and admins)
-- ---------------------------------------------------------------------
create policy "read camp updates" on public.camp_updates for select to authenticated using (true);
create policy "admins manage camp updates" on public.camp_updates for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "staff read reminders" on public.reminders for select to authenticated using (public.my_role() in ('instructor', 'admin'));
create policy "admins manage reminders" on public.reminders for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- feedback: own class only for instructors
-- ---------------------------------------------------------------------
create policy "staff read feedback" on public.feedback_results for select to authenticated using (public.can_manage_course(course_id));
create policy "admins manage feedback" on public.feedback_results for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Learn, Past Resources, Merchandise
-- ---------------------------------------------------------------------
create policy "read published posts" on public.posts for select to authenticated using (published or public.is_admin());
create policy "admins manage posts" on public.posts for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read past resources" on public.past_resources for select to authenticated using (true);
create policy "admins manage past resources" on public.past_resources for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read visible merch" on public.merch_items for select to authenticated using (visible or public.is_admin());
create policy "admins manage merch" on public.merch_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
