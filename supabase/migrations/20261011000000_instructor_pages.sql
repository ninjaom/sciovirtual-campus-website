-- Phase 3: instructor pages.
--   * Course files (announcement attachments): a private bucket that only
--     the course's students, instructors and admins can open.
--   * Class ratings for the course dashboard: per-session averages for the
--     instructor's own course, plus the camp average and the class's rank
--     (other courses' ratings are never returned, only the rank).
--   * Midpoint/Final results keep the camp's response count and the
--     class's rank (filled by the Feedback Imports page, Phase 6).

-- ---------------------------------------------------------------------
-- Course files
-- ---------------------------------------------------------------------
create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-files', 'course-files', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'])
on conflict (id) do nothing;

-- Files live under "<course id>/...".
create policy "course members open course files" on storage.objects for select to authenticated
  using (bucket_id = 'course-files' and public.in_course(public.try_uuid((storage.foldername(name))[1])));
create policy "course staff add course files" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-files' and public.can_manage_course(public.try_uuid((storage.foldername(name))[1])));
create policy "course staff remove course files" on storage.objects for delete to authenticated
  using (bucket_id = 'course-files' and public.can_manage_course(public.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------
-- Class ratings (course dashboard and Daily feedback)
-- ---------------------------------------------------------------------
create or replace function public.course_ratings(p_course uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ev uuid := (select event_id from public.courses where id = p_course);
  result jsonb;
begin
  if not public.can_manage_course(p_course) then raise exception 'Not your course' using errcode = '42501'; end if;
  with course_avgs as (
    select c.id, avg(a.rating) as avg
    from public.courses c
    join public.sessions s on s.course_id = c.id
    join public.attendance a on a.session_id = s.id and a.rating is not null
    where c.event_id = ev and not c.archived
    group by c.id
  ),
  ranked as (
    select id, avg, rank() over (order by avg desc) as rank from course_avgs
  )
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('number', s.number, 'average', round(x.avg, 2), 'responses', coalesce(x.n, 0)) order by s.number)
      from public.sessions s
      left join lateral (
        select avg(a.rating) as avg, count(a.rating) as n from public.attendance a where a.session_id = s.id
      ) x on true
      where s.course_id = p_course), '[]'::jsonb),
    'camp_average', (select round(avg(a.rating), 2) from public.attendance a
                     join public.sessions s on s.id = a.session_id
                     join public.courses c on c.id = s.course_id and c.event_id = ev and not c.archived),
    'rank', (select rank from ranked where id = p_course),
    'of', (select count(*) from public.courses where event_id = ev and not archived)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------
-- Midpoint/Final results: camp response count and the class's rank
-- ---------------------------------------------------------------------
alter table public.feedback_results add column camp_responses int;
alter table public.feedback_results add column class_rank int;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.course_ratings(uuid), public.try_uuid(text) to authenticated;
