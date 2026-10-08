-- FAKE TEST DATA for the TEST project only. Never run on the real project.
-- Paste into the test project's SQL Editor and run. Safe to run again:
-- it removes the previous fake event first.
-- The last query lists every fake account's ID and setup code.

delete from public.people where person_code like 'ADM27%' or person_code like 'CO_27%' or person_code ~ '^27[A-Z]{2}00[0-9]{2}$';
delete from public.events where name = 'ScioCamp 2027 (test)';

with ev as (
  insert into public.events (name, year, is_current) values ('ScioCamp 2027 (test)', 2027, true) returning id
)
insert into public.settings (event_id, leaderboard_state) select id, 'live' from ev;

-- Grade items (2026 values)
insert into public.grade_items (event_id, name, kind, max_points, points_per_session, sort)
select e.id, x.name, x.kind::public.grade_item_kind, x.max, x.pps, x.sort
from public.events e,
  (values ('Midpoint', 'manual', 300, null::numeric, 1), ('Final', 'manual', 340, null, 2),
          ('Attendance', 'attendance', 270, 30, 3), ('Bonus', 'manual', 90, null, 4)) as x(name, kind, max, pps, sort)
where e.is_current;

-- Courses
insert into public.courses (event_id, short_code, name, time_slot, days, sort)
select e.id, x.code, x.name, x.slot, 'Mon, Wed, Fri', x.sort
from public.events e,
  (values ('COA', 'Course A', '1–2 PM ET', 1), ('COB', 'Course B', '4–5 PM ET', 2), ('COC', 'Course C', '6–7 PM ET', 3)) as x(code, name, slot, sort)
where e.is_current;

-- 9 sessions per course
insert into public.sessions (course_id, number)
select c.id, n from public.courses c join public.events e on e.id = c.event_id and e.is_current, generate_series(1, 9) n;

-- People (setup codes are created automatically)
insert into public.people (person_code, role, first_name, last_name, email) values
  ('ADM27DA01', 'admin', 'Director', 'A', 'director.a@example.com'),
  ('ADM27DB01', 'admin', 'Director', 'B', 'director.b@example.com'),
  ('COA27IA01', 'instructor', 'Instructor', 'A', 'instructor.a@example.com'),
  ('COB27IB01', 'instructor', 'Instructor', 'B', 'instructor.b@example.com'),
  ('COC27IC01', 'instructor', 'Instructor', 'C', 'instructor.c@example.com');

insert into public.people (person_code, role, first_name, last_name, grade, school, city, state, student_email, parent_email)
select '27' || l || l || lpad(i::text, 4, '0'), 'student', 'First ' || l, 'Last ' || l, 4 + (i % 5), 'School ' || l, 'City ' || l,
       (array['TX', 'GA', 'CA', 'NJ', 'WA', 'IL'])[1 + i % 6], 'student.' || lower(l) || '@example.com', 'parent.' || lower(l) || '@example.com'
from (select i, chr(64 + i) as l from generate_series(1, 12) i) s;

-- Instructors teach their course; students take 1–3 courses
insert into public.course_staff (course_id, person_id)
select c.id, p.id from public.courses c join public.people p on left(p.person_code::text, 3) = c.short_code::text
join public.events e on e.id = c.event_id and e.is_current where p.role = 'instructor';

insert into public.enrollments (course_id, person_id)
select c.id, p.id
from public.people p
join public.courses c on c.event_id = (select id from public.events where is_current)
where p.role = 'student' and p.person_code ~ '^27[A-Z]{2}00[0-9]{2}$'
  and (c.short_code = 'COA' or (c.short_code = 'COB' and right(p.person_code::text, 1)::int % 2 = 0)
       or (c.short_code = 'COC' and right(p.person_code::text, 1)::int % 3 = 0));

-- Teams
insert into public.teams (event_id, number, name, counselors)
select e.id, x.n, x.name, x.c from public.events e,
  (values (1, 'Team A', 'Counselor A'), (2, 'Team B', 'Counselor B / Counselor C')) as x(n, name, c)
where e.is_current;
insert into public.team_members (team_id, person_id, event_id)
select t.id, p.id, t.event_id
from public.people p
join public.teams t on t.event_id = (select id from public.events where is_current)
  and t.number = 1 + (right(p.person_code::text, 2)::int % 2)
where p.role = 'student' and p.person_code ~ '^27[A-Z]{2}00[0-9]{2}$';

-- Zoom host placeholders
insert into public.course_zoom_hosts (course_id, host_email, host_password)
select c.id, 'host.' || lower(c.short_code::text) || '@example.com', 'test-password'
from public.courses c join public.events e on e.id = c.event_id and e.is_current;

-- IDs and setup codes for signing up
select p.person_code as id, p.role, p.first_name || ' ' || p.last_name as name, sc.code as setup_code
from public.people p join public.setup_codes sc on sc.person_id = p.id and sc.used_at is null
order by p.role, p.person_code;
