-- TESTER ACCOUNTS for the TEST project only. Never run on the real project.
-- Run test_camp.sql first, then paste this into the test project's SQL
-- Editor and run it. Safe to run again (run it again after every
-- test_camp.sql run: it resets the testers' courses, team and scores).
--
-- 30 accounts for the people test (fake data only):
--   * 10 admins:      ADM27OL01, ADM27AM01, ADM27EN01, ADM27AC01, ADM27KD01,
--                     ADM27CT01, ADM27CH01, ADM27MH01, ADM27U101, ADM27U201
--   * 8 instructors:  I1-I8, one each in Courses A, B, H, I, J, K, L, M
--                     (COA27I101, COB27I201, COH27I301, ... COM27I801)
--   * 12 students:    S1-S12 = 27SA0001 ... 27SL0012, each in 2 or 3 of
--                     those 8 courses, so testers see each other's work
-- Names show as "Tester OL", "Tester I1", "Tester S1" and so on.
-- The old fake admins ADM27DA01 and ADM27DB01 are deleted.
--
-- The result lists every tester account that hasn't signed up yet, with
-- its setup code, to hand out in the group chat.

begin;

-- ---------------------------------------------------------------------
-- Remove the old fake admins (Director A and B), including any sign-in
-- ---------------------------------------------------------------------
do $$
declare
  code text;
begin
  foreach code in array array['ADM27DA01', 'ADM27DB01'] loop
    if exists (select 1 from public.people where upper(person_code::text) = code) then
      perform public.delete_person(code);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- The 30 testers (kept if they already exist, so sign-ups survive)
-- ---------------------------------------------------------------------
drop table if exists pg_temp.testers;
create temporary table testers (code text, role public.role, initials text, courses text[], sort int);
insert into testers values
  ('ADM27OL01', 'admin', 'OL', null, 1), ('ADM27AM01', 'admin', 'AM', null, 2),
  ('ADM27EN01', 'admin', 'EN', null, 3), ('ADM27AC01', 'admin', 'AC', null, 4),
  ('ADM27KD01', 'admin', 'KD', null, 5), ('ADM27CT01', 'admin', 'CT', null, 6),
  ('ADM27CH01', 'admin', 'CH', null, 7), ('ADM27MH01', 'admin', 'MH', null, 8),
  ('ADM27U101', 'admin', 'U1', null, 9), ('ADM27U201', 'admin', 'U2', null, 10),
  ('COA27I101', 'instructor', 'I1', array['COA'], 11), ('COB27I201', 'instructor', 'I2', array['COB'], 12),
  ('COH27I301', 'instructor', 'I3', array['COH'], 13), ('COI27I401', 'instructor', 'I4', array['COI'], 14),
  ('COJ27I501', 'instructor', 'I5', array['COJ'], 15), ('COK27I601', 'instructor', 'I6', array['COK'], 16),
  ('COL27I701', 'instructor', 'I7', array['COL'], 17), ('COM27I801', 'instructor', 'I8', array['COM'], 18),
  ('27SA0001', 'student', 'S1', array['COA', 'COB', 'COH'], 19), ('27SB0002', 'student', 'S2', array['COB', 'COI'], 20),
  ('27SC0003', 'student', 'S3', array['COH', 'COJ', 'COK'], 21), ('27SD0004', 'student', 'S4', array['COI', 'COL'], 22),
  ('27SE0005', 'student', 'S5', array['COJ', 'COM', 'COA'], 23), ('27SF0006', 'student', 'S6', array['COK', 'COA'], 24),
  ('27SG0007', 'student', 'S7', array['COL', 'COB', 'COH'], 25), ('27SH0008', 'student', 'S8', array['COM', 'COI'], 26),
  ('27SI0009', 'student', 'S9', array['COA', 'COJ', 'COL'], 27), ('27SJ0010', 'student', 'S10', array['COB', 'COK'], 28),
  ('27SK0011', 'student', 'S11', array['COH', 'COM', 'COI'], 29), ('27SL0012', 'student', 'S12', array['COJ', 'COA'], 30);

insert into public.people (person_code, role, first_name, last_name, email, grade, school, city, state, student_email, parent_email)
select t.code, t.role, 'Tester', t.initials,
       case when t.role <> 'student' then 'tester.' || lower(t.initials) || '@example.com' end,
       case when t.role = 'student' then 6 + t.sort % 3 end,
       case when t.role = 'student' then 'Tester School' end,
       case when t.role = 'student' then 'Austin' end,
       case when t.role = 'student' then 'TX' end,
       case when t.role = 'student' then 'tester.' || lower(t.initials) || '@example.com' end,
       case when t.role = 'student' then 'parent.' || lower(t.initials) || '@example.com' end
from testers t
on conflict (person_code) do nothing;

-- Testers who haven't signed up yet don't have a username (they choose one)
update public.people p set username = null
from testers t where p.person_code = t.code and p.role = 'student' and p.auth_user_id is null;
update public.people p set gtky_done = true
from testers t where p.person_code = t.code and p.role = 'student';

-- ---------------------------------------------------------------------
-- Reset the testers' camp setup: courses, team, check-ins, scores, points
-- ---------------------------------------------------------------------
drop table if exists pg_temp.tp;
create temporary table tp as
select p.id, t.code, t.role, t.courses, t.sort from public.people p join testers t on t.code = p.person_code::text;

delete from public.course_staff cs using tp where cs.person_id = tp.id;
delete from public.enrollments en using tp where en.person_id = tp.id;
delete from public.team_members tm using tp where tm.person_id = tp.id;
delete from public.attendance a using tp where a.person_id = tp.id;
delete from public.points pt using tp where pt.person_id = tp.id;
alter table public.grades disable trigger grades_log;
delete from public.grades g using tp where g.person_id = tp.id;

insert into public.course_staff (course_id, person_id)
select c.id, tp.id
from tp join public.courses c on c.short_code = tp.courses[1]
join public.events e on e.id = c.event_id and e.is_current
where tp.role = 'instructor';

insert into public.enrollments (course_id, person_id)
select c.id, tp.id
from tp cross join lateral unnest(tp.courses) as u(course_code)
join public.courses c on c.short_code = u.course_code
join public.events e on e.id = c.event_id and e.is_current
where tp.role = 'student';

-- Students spread over the 12 teams
insert into public.team_members (team_id, person_id, event_id)
select t.id, tp.id, t.event_id
from tp join public.teams t on t.event_id = (select id from public.events where is_current) and t.number = 1 + tp.sort % 12
where tp.role = 'student';

-- Check-ins for sessions 1-4 (most of them), Midpoint scores and some points,
-- so the testers' pages aren't empty
insert into public.attendance (session_id, person_id, rating, comment, submitted_at)
select s.id, en.person_id, 6 + (hashtext(s.id::text || en.person_id::text) & 3), null,
       timestamptz '2027-07-05 14:00-04' + ((array[0, 2, 4, 7])[s.number] || ' days')::interval
from public.enrollments en
join tp on tp.id = en.person_id
join public.sessions s on s.course_id = en.course_id and s.number <= 4
where (hashtext(en.person_id::text || s.id::text) & 255) < 218;

insert into public.grades (course_id, person_id, grade_item_id, points)
select en.course_id, en.person_id, gi.id, 150 + (abs(hashtext(en.person_id::text || en.course_id::text)) % 151)
from public.enrollments en
join tp on tp.id = en.person_id
join public.courses c on c.id = en.course_id
join public.grade_items gi on gi.event_id = c.event_id and gi.course_id is null and gi.name = 'Midpoint';
alter table public.grades enable trigger grades_log;

insert into public.points (challenge_id, person_id, points)
select ch.id, tp.id, abs(hashtext(ch.id::text || tp.id::text)) % (ch.individual_max::int + 1)
from tp join public.challenges ch on ch.event_id = (select id from public.events where is_current) and ch.visible
where tp.role = 'student' and ch.individual_max is not null;

-- Fake camp updates are posted by OL
update public.camp_updates set author_id = (select id from public.people where person_code = 'ADM27OL01')
where event_id = (select id from public.events where is_current) and author_id is null;

-- The leaderboard's saved copies are refreshed on the next visit
delete from public.leaderboard_cache;
delete from public.leaderboard_views;

commit;

-- ---------------------------------------------------------------------
-- Setup codes to hand out (testers who haven't signed up yet)
-- ---------------------------------------------------------------------
select t.initials as tester, p.person_code as id, p.role,
       coalesce(array_to_string(t.courses, ', '), '') as courses,
       sc.code as setup_code
from testers t
join public.people p on p.person_code = t.code
join public.setup_codes sc on sc.person_id = p.id and sc.used_at is null
order by t.sort;
