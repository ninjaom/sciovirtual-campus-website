-- Phase 4: student pages.
--   * Comments can't be edited by anyone, and only the course's instructors
--     and admins can remove them (students can't delete their own).

drop policy if exists "authors edit comments" on public.announcement_comments;
drop policy if exists "authors and course staff remove comments" on public.announcement_comments;
create policy "course staff remove comments" on public.announcement_comments for delete to authenticated
  using (public.can_manage_course(public.announcement_course(announcement_id)));
