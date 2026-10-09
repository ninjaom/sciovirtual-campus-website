-- Fixes found while building the fake test camp.

-- The "archive, don't delete" rule applies to changes made through Campus
-- (signed-in admins). Database maintenance, like clearing a whole test
-- event, is not blocked. Runs as the caller so current_user is accurate.
create or replace function public.course_delete_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and (exists (select 1 from public.enrollments where course_id = old.id)
     or exists (select 1 from public.grades where course_id = old.id)
     or exists (select 1 from public.attendance a join public.sessions s on s.id = a.session_id where s.course_id = old.id)) then
    raise exception 'This course has students or scores, so it can only be archived' using errcode = '23503';
  end if;
  return old;
end $$;

-- Score log: rows removed because their course, student or grade item was
-- deleted are not logged (the log row would point at something gone).
create or replace function public.log_grade_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- Not logged when the course, student or item itself is being deleted.
    if not exists (select 1 from public.courses where id = old.course_id)
       or not exists (select 1 from public.people where id = old.person_id)
       or not exists (select 1 from public.grade_items where id = old.grade_item_id) then
      return old;
    end if;
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

revoke execute on function public.course_delete_guard, public.log_grade_edit from public, anon, authenticated;
