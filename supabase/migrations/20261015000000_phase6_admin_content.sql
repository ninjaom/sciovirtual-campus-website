-- Phase 6: remaining admin pages and content.
--   * Camp Announcements and Merchandise: files and pictures live in two
--     private buckets anyone signed in can open; only admins add or remove.
--   * Learn: guides and posts (Markdown), with a private bucket for their
--     PDFs and pictures. Readers see published items only.
--   * Past Resources: one link per course and year, with a subject, and a
--     published/archived state like Learn.
--   * Feedback Imports: results come from an uploaded CSV (the form's
--     sheet stays private); an import history, and one function that
--     replaces a form's results in a single step.
--   * Edit Logs: the activity log gains structured columns (type, course,
--     where, what, old -> new) and logs points, attendance, attendance
--     codes, account resets and leaderboard status changes row by row.
-- Nothing here is readable by people without an account; admin-only data
-- stays admin-only (tests in security_test.sql).

-- ---------------------------------------------------------------------
-- File buckets
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('camp-files', 'camp-files', false, 10485760, array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword']),
  ('merch', 'merch', false, 1048576, array['image/jpeg', 'image/png', 'image/webp']),
  ('learn-files', 'learn-files', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "signed-in users open camp files" on storage.objects for select to authenticated
  using (bucket_id in ('camp-files', 'merch', 'learn-files') and public.has_account());
create policy "admins add camp files" on storage.objects for insert to authenticated
  with check (bucket_id in ('camp-files', 'merch', 'learn-files') and public.is_admin());
create policy "admins change camp files" on storage.objects for update to authenticated
  using (bucket_id in ('camp-files', 'merch', 'learn-files') and public.is_admin());
create policy "admins remove camp files" on storage.objects for delete to authenticated
  using (bucket_id in ('camp-files', 'merch', 'learn-files') and public.is_admin());

-- ---------------------------------------------------------------------
-- Learn and Past Resources
-- ---------------------------------------------------------------------
alter table public.posts add column sort int not null default 0;
alter table public.posts add column subject text check (subject in ('bio', 'earth', 'chem', 'inq'));
create index posts_listing on public.posts (published, type, section, sort);

alter table public.past_resources alter column title set default '';
alter table public.past_resources add column subject text check (subject in ('bio', 'earth', 'chem', 'inq'));
alter table public.past_resources add column published boolean not null default true;
alter table public.past_resources add column archived boolean not null default false;
alter policy "read past resources" on public.past_resources
  using ((published and public.has_account()) or public.is_admin());

-- Keep updated_at honest when a post changes
create or replace function public.touch_post() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger posts_touch before update on public.posts for each row execute function public.touch_post();

-- ---------------------------------------------------------------------
-- Feedback imports
-- ---------------------------------------------------------------------
create table public.feedback_imports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.feedback_kind not null,
  imported_by uuid references public.people (id) on delete set null,
  imported_at timestamptz not null default now(),
  responses int not null,
  unmatched int not null default 0,
  source text not null default 'csv' check (source = 'csv')
);
alter table public.feedback_imports enable row level security;
revoke all on public.feedback_imports from anon;
create policy "admins read feedback imports" on public.feedback_imports for select to authenticated using (public.is_admin());

-- Replaces one form's results for the current event in a single step.
-- p_rows: [{course_id, questions, comments, responses, class_rank}]
create or replace function public.admin_import_feedback(
  p_kind public.feedback_kind, p_rows jsonb, p_responses int, p_unmatched int, p_source text)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  ev uuid := public.current_event();
  n int;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  delete from public.feedback_results fr
    using public.courses c
    where fr.course_id = c.id and c.event_id = ev and fr.kind = p_kind;
  insert into public.feedback_results (course_id, kind, questions, comments, responses, camp_responses, class_rank, imported_at)
  select (r ->> 'course_id')::uuid, p_kind, coalesce(r -> 'questions', '[]'), coalesce(r -> 'comments', '[]'),
         coalesce((r ->> 'responses')::int, 0), p_responses, (r ->> 'class_rank')::int, now()
  from jsonb_array_elements(p_rows) r
  join public.courses c on c.id = (r ->> 'course_id')::uuid and c.event_id = ev;
  get diagnostics n = row_count;
  insert into public.feedback_imports (event_id, kind, imported_by, responses, unmatched, source)
    values (ev, p_kind, public.me(), p_responses, p_unmatched, p_source);
  insert into public.activity_log (event_id, actor_id, action)
    values (ev, public.me(), 'Imported ' || initcap(p_kind::text) || ' feedback · ' || p_responses || ' responses');
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Edit Logs: structured activity log
-- ---------------------------------------------------------------------
alter table public.activity_log add column kind text check (kind in ('points', 'attendance', 'accounts', 'leaderboard'));
alter table public.activity_log add column course_id uuid references public.courses (id) on delete set null;
alter table public.activity_log add column target text;
alter table public.activity_log add column field text;
alter table public.activity_log add column old_value text;
alter table public.activity_log add column new_value text;
create index activity_log_kind on public.activity_log (kind, at desc);

create or replace function public.person_label(p uuid) returns text
language sql stable security definer set search_path = '' as $$
  select first_name || ' ' || last_name from public.people where id = p
$$;
revoke execute on function public.person_label(uuid) from public, anon, authenticated;

-- Points: one row per change (replaces the per-batch summary)
drop trigger if exists points_log_insert on public.points;
drop trigger if exists points_log_update on public.points;
create or replace function public.log_point_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.points := coalesce(new, old);
  ch public.challenges;
  who text;
begin
  if public.me() is null then return null; end if; -- bulk loads from the SQL Editor aren't logged
  select * into ch from public.challenges where id = r.challenge_id;
  who := case when r.team_id is not null then (select name from public.teams where id = r.team_id)
              else public.person_label(r.person_id) end;
  insert into public.activity_log (event_id, actor_id, action, kind, target, field, old_value, new_value)
  values (ch.event_id, public.me(), 'Entered points · ' || ch.name, 'points',
          ch.name || ' · ' || coalesce(who, '?'),
          case when r.team_id is not null then 'Team points' else 'Points' end,
          case when tg_op = 'INSERT' then null else old.points::text end,
          case when tg_op = 'DELETE' then null else new.points::text end);
  return null;
end $$;
create trigger points_log after insert or update or delete on public.points
  for each row execute function public.log_point_change();

-- Course takeovers set by hand
create or replace function public.log_takeover_override() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.me() is null then return null; end if;
  if new.takeover_override is distinct from old.takeover_override then
    insert into public.activity_log (event_id, actor_id, action, kind, target, field, old_value, new_value)
    values (new.event_id, public.me(), 'Changed Course Takeovers · ' || new.name, 'points',
            'Course Takeovers · ' || new.name, 'Team points', old.takeover_override::text, new.takeover_override::text);
  end if;
  return null;
end $$;
create trigger teams_log_takeover after update on public.teams
  for each row execute function public.log_takeover_override();

-- Leaderboard status
create or replace function public.log_leaderboard_state() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  label constant jsonb := '{"live": "Live", "frozen": "Frozen", "hidden": "Frozen & Hidden"}';
begin
  if new.leaderboard_state is distinct from old.leaderboard_state then
    insert into public.activity_log (event_id, actor_id, action, kind, target, field, old_value, new_value)
    values (new.event_id, public.me(), case new.leaderboard_state
      when 'frozen' then 'Froze the leaderboard'
      when 'hidden' then 'Hid the leaderboard'
      else 'Made the leaderboard live' end,
      'leaderboard', null, 'Status', label ->> old.leaderboard_state::text, label ->> new.leaderboard_state::text);
  end if;
  return null;
end $$;

-- Attendance fixes (check-ins added or removed by an admin)
create or replace function public.log_attendance_fix() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.attendance := coalesce(new, old);
  s public.sessions;
  c public.courses;
begin
  if not public.is_admin() then return null; end if;
  select * into s from public.sessions where id = r.session_id;
  select * into c from public.courses where id = s.course_id;
  insert into public.activity_log (event_id, actor_id, action, kind, course_id, target, field, old_value, new_value)
  values (c.event_id, public.me(), 'Fixed attendance · ' || c.name, 'attendance', c.id,
          c.name || ' · ' || coalesce(public.person_label(r.person_id), '?'), 'S' || s.number,
          case when tg_op = 'INSERT' then 'Missed' else 'Present' end,
          case when tg_op = 'INSERT' then 'Present' else 'Missed' end);
  return null;
end $$;
create trigger attendance_log_fix after insert or delete on public.attendance
  for each row execute function public.log_attendance_fix();

-- Attendance codes
create or replace function public.log_attendance_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  c public.courses;
begin
  if not public.is_admin() then return null; end if;
  if tg_op = 'UPDATE' and new.code is not distinct from old.code then return null; end if;
  select * into s from public.sessions where id = coalesce(new.session_id, old.session_id);
  select * into c from public.courses where id = s.course_id;
  insert into public.activity_log (event_id, actor_id, action, kind, course_id, target, field, old_value, new_value)
  values (c.event_id, public.me(), 'Changed a class code · ' || c.name, 'attendance', c.id,
          c.name, 'S' || s.number || ' code',
          case when tg_op = 'INSERT' then null else old.code end,
          case when tg_op = 'DELETE' then null else new.code end);
  return null;
end $$;
create trigger attendance_codes_log after insert or update or delete on public.attendance_codes
  for each row execute function public.log_attendance_code();

-- Accounts: new setup codes issued by an admin (first sign-up or reset)
create or replace function public.log_setup_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.people;
begin
  if new.created_by is null then return null; end if;
  select * into p from public.people where id = new.person_id;
  insert into public.activity_log (event_id, actor_id, action, kind, target, field, old_value, new_value)
  values (public.current_event(), public.me(), 'Issued a setup code · ' || p.person_code, 'accounts',
          p.person_code::text, case when p.auth_user_id is not null then 'Password' else 'Setup code' end,
          null, case when p.auth_user_id is not null then 'Reset' else 'New code' end);
  return null;
end $$;
create trigger setup_codes_log after insert on public.setup_codes
  for each row execute function public.log_setup_code();

-- Accounts added from the website
create or replace function public.log_person_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.me() is null then return null; end if; -- SQL Editor / imports by the database itself
  insert into public.activity_log (event_id, actor_id, action, kind, target, field, old_value, new_value)
  values (public.current_event(), public.me(), 'Added ' || new.person_code, 'accounts',
          new.person_code::text, 'Account', null, 'Added (' || initcap(new.role::text) || ')');
  return null;
end $$;
create trigger people_log_added after insert on public.people
  for each row execute function public.log_person_added();

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.log_point_change(), public.log_takeover_override(), public.log_attendance_fix(),
  public.log_attendance_code(), public.log_setup_code(), public.log_person_added(), public.touch_post() from authenticated;
grant execute on function public.admin_import_feedback(public.feedback_kind, jsonb, int, int, text) to authenticated;
