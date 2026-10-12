-- Senior Instructor: a title admins give some instructor accounts. It adds
-- no permissions; it is only shown on the website (Accounts, the instructor's
-- Account page, Instructor Roster).
--   * Only admins can set it (people_guard blocks everyone else).
--   * Only instructor accounts can have it.
--   * Changes are written to the Edit Logs (Accounts).

alter table public.people add column senior boolean not null default false;
alter table public.people add constraint senior_is_instructor check (not senior or role = 'instructor');

create or replace function public.people_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  if (new.id, new.auth_user_id, new.person_code, new.role, new.first_name, new.last_name, new.username,
      new.grade, new.school, new.city, new.state, new.student_email, new.parent_email, new.email, new.signed_up_at,
      new.gtky_done, new.senior)
     is distinct from
     (old.id, old.auth_user_id, old.person_code, old.role, old.first_name, old.last_name, old.username,
      old.grade, old.school, old.city, old.state, old.student_email, old.parent_email, old.email, old.signed_up_at,
      old.gtky_done, old.senior) then
    raise exception 'Only your photo and recovery email can be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- Same rows as before; the title is added at the end so others can see it.
create or replace view public.people_directory with (security_barrier = true) as
  select p.id, p.first_name, p.last_name, p.role, p.username, p.avatar_path, p.senior
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

create or replace function public.log_senior_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.me() is null or new.senior is not distinct from old.senior then return null; end if;
  insert into public.activity_log (event_id, actor_id, action, kind, target, field, old_value, new_value)
  values (public.current_event(), public.me(),
          case when new.senior then 'Made Senior Instructor · ' else 'Removed Senior Instructor · ' end || new.person_code,
          'accounts', new.person_code::text, 'Senior Instructor',
          case when old.senior then 'Yes' else 'No' end, case when new.senior then 'Yes' else 'No' end);
  return null;
end $$;
create trigger people_log_senior after update of senior on public.people
  for each row execute function public.log_senior_change();

revoke execute on function public.log_senior_change() from public, anon, authenticated;
