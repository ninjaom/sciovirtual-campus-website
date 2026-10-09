-- FAKE CAMP for the TEST project only. Never run on the real project.
-- Paste into the test project's SQL Editor and run. Safe to run again.
--
-- Builds a full fake ScioCamp 2027: 15 courses, 25 instructors, 500
-- students, 12 teams, 9 sessions per course with check-ins for the first
-- 4, Midpoint scores, live events and async challenges with points.
--
-- Accounts that already signed up (like your ADM27DA01) are kept; their
-- names and IDs stay the same. The last query lists the setup codes.

begin;

-- ---------------------------------------------------------------------
-- The event (reused if it exists) and a clean slate for its camp data
-- ---------------------------------------------------------------------
insert into public.events (name, year, is_current)
select 'ScioCamp 2027 (test)', 2027, true
where not exists (select 1 from public.events where name = 'ScioCamp 2027 (test)');
update public.events set is_current = (name = 'ScioCamp 2027 (test)');

insert into public.settings (event_id) select id from public.events where is_current
on conflict (event_id) do nothing;
update public.settings set
  leaderboard_state = 'live', leaderboard_top_n = 350, course_top_n = 10, takeover_bonus = 250,
  sessions_per_course = 9, courses_that_count = 3, admin_id_prefix = 'ADM',
  first_day = '2027-07-06', last_day = '2027-07-24',
  faq_url = 'https://docs.google.com/document/d/example', attendance_url = 'https://www.sciovirtual.org/attendance'
where event_id = (select id from public.events where is_current);

delete from public.courses where event_id = (select id from public.events where is_current);
delete from public.teams where event_id = (select id from public.events where is_current);
delete from public.challenges where event_id = (select id from public.events where is_current);
delete from public.grade_items where event_id = (select id from public.events where is_current);
delete from public.quick_links where event_id = (select id from public.events where is_current);
delete from public.reminders where event_id = (select id from public.events where is_current);
delete from public.camp_updates where event_id = (select id from public.events where is_current);
delete from public.activity_log where event_id = (select id from public.events where is_current);

-- ---------------------------------------------------------------------
-- Grade items (2026 values) and courses (sessions are created for each)
-- ---------------------------------------------------------------------
insert into public.grade_items (event_id, name, kind, max_points, points_per_session, sort)
select e.id, x.name, x.kind::public.grade_item_kind, x.max, x.pps, x.sort
from public.events e,
  (values ('Midpoint', 'manual', 300, null::numeric, 1), ('Final', 'manual', 340, null, 2),
          ('Attendance', 'attendance', 270, 30, 3), ('Bonus', 'manual', 90, null, 4)) as x(name, kind, max, pps, sort)
where e.is_current;

insert into public.courses (event_id, short_code, name, time_slot, days, zoom_join_url, sort)
select e.id, 'CO' || chr(64 + i), 'Course ' || chr(64 + i),
       (array['12–1 PM ET', '1–2 PM ET', '2–3 PM ET', '4–5 PM ET', '6–7 PM ET'])[1 + (i - 1) % 5],
       'Mon, Wed, Fri', 'https://us02web.zoom.us/j/00000000' || lpad(i::text, 2, '0'), i
from public.events e, generate_series(1, 15) i
where e.is_current;

insert into public.course_zoom_hosts (course_id, host_email, host_password)
select c.id, 'host' || (c.sort % 5 + 1) || '@example.com', 'test-password-' || (c.sort % 5 + 1)
from public.courses c join public.events e on e.id = c.event_id and e.is_current;

-- ---------------------------------------------------------------------
-- People (kept if they exist, so signed-up accounts still work)
-- ---------------------------------------------------------------------
insert into public.people (person_code, role, first_name, last_name, email) values
  ('ADM27DA01', 'admin', 'Director', 'A', 'director.a@example.com'),
  ('ADM27DB01', 'admin', 'Director', 'B', 'director.b@example.com')
on conflict (person_code) do nothing;

-- Instructors: one per course, plus a second for the first 10 courses
insert into public.people (person_code, role, first_name, last_name, email)
select 'CO' || chr(64 + i) || '27I' || chr(64 + i) || '01', 'instructor'::public.role, 'Instructor', chr(64 + i), 'instructor.' || lower(chr(64 + i)) || '@example.com'
from generate_series(1, 15) i
union all
select 'CO' || chr(64 + i) || '27J' || chr(64 + i) || '01', 'instructor'::public.role, 'Instructor', chr(64 + i) || '2', 'instructor.' || lower(chr(64 + i)) || '2@example.com'
from generate_series(1, 10) i
on conflict (person_code) do nothing;

-- Students: 27 + two letters + 4 digits
insert into public.people (person_code, role, first_name, last_name, grade, school, city, state, student_email, parent_email)
select '27' || chr(65 + (i / 26) % 26) || chr(65 + i % 26) || lpad(i::text, 4, '0'), 'student'::public.role,
       'First ' || chr(65 + (i / 26) % 26) || chr(65 + i % 26), 'Last ' || lpad(i::text, 3, '0'),
       4 + i % 6, 'School ' || (1 + i % 40), 'City ' || (1 + i % 30),
       (array['TX', 'GA', 'CA', 'NJ', 'WA', 'IL', 'NY', 'MA', 'FL', 'VA'])[1 + i % 10],
       'student' || i || '@example.com', 'parent' || i || '@example.com'
from generate_series(1, 500) i
on conflict (person_code) do nothing;

-- Instructors teach their course
insert into public.course_staff (course_id, person_id)
select c.id, p.id
from public.people p
join public.courses c on c.short_code = left(p.person_code::text, 3)
join public.events e on e.id = c.event_id and e.is_current
where p.role = 'instructor' and p.person_code::text ~ '^CO[A-O]27[IJ][A-O]01$';

-- Each student takes 1 to 4 courses (spread evenly)
insert into public.enrollments (course_id, person_id)
select distinct c.id, s.id
from (select p.id, row_number() over (order by p.person_code) as n
      from public.people p where p.role = 'student' and p.person_code::text ~ '^27[A-Z]{2}[0-9]{4}$') s
cross join generate_series(0, 3) k
join public.courses c on c.event_id = (select id from public.events where is_current)
  and c.sort = 1 + ((s.n * 7 + k * 4) % 15)
where k < 1 + (s.n % 4);

-- ---------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------
insert into public.teams (event_id, number, name, counselors)
select e.id, i, 'Team ' || chr(64 + i), 'Counselor ' || chr(64 + i) || case when i % 2 = 0 then ' / Counselor ' || chr(76 + i) else '' end
from public.events e, generate_series(1, 12) i
where e.is_current;

insert into public.team_members (team_id, person_id, event_id)
select t.id, s.id, t.event_id
from (select p.id, row_number() over (order by p.person_code) as n
      from public.people p where p.role = 'student' and p.person_code::text ~ '^27[A-Z]{2}[0-9]{4}$') s
join public.teams t on t.event_id = (select id from public.events where is_current) and t.number = 1 + s.n % 12;

-- ---------------------------------------------------------------------
-- Attendance codes and check-ins for sessions 1-4 (about 85% attend)
-- ---------------------------------------------------------------------
insert into public.attendance_codes (session_id, code)
select s.id, (array['APPLE', 'RIVER', 'COMET', 'MAPLE', 'ORBIT', 'PRISM', 'CEDAR', 'NOVA', 'DELTA'])[s.number]
from public.sessions s join public.courses c on c.id = s.course_id join public.events e on e.id = c.event_id and e.is_current;

insert into public.attendance (session_id, person_id, rating, comment, submitted_at)
select s.id, en.person_id, 6 + (hashtext(s.id::text || en.person_id::text) & 3),
       case when hashtext(en.person_id::text || s.number) % 9 = 0 then 'Student comment' end,
       timestamptz '2027-07-06 14:00-04' + ((s.number - 1) * 2 || ' days')::interval
from public.enrollments en
join public.courses c on c.id = en.course_id and c.event_id = (select id from public.events where is_current)
join public.sessions s on s.course_id = c.id and s.number <= 4
where (hashtext(en.person_id::text || s.id::text) & 255) < 218;

-- ---------------------------------------------------------------------
-- Scores: Midpoint for most students (no edit log rows for fake data)
-- ---------------------------------------------------------------------
alter table public.grades disable trigger grades_log;
insert into public.grades (course_id, person_id, grade_item_id, points)
select en.course_id, en.person_id, gi.id, 150 + (abs(hashtext(en.person_id::text || en.course_id::text)) % 151)
from public.enrollments en
join public.courses c on c.id = en.course_id and c.event_id = (select id from public.events where is_current)
join public.grade_items gi on gi.event_id = c.event_id and gi.course_id is null and gi.name = 'Midpoint'
where c.sort <= 12 and abs(hashtext(en.person_id::text)) % 10 <> 0;
insert into public.grades (course_id, person_id, grade_item_id, points)
select en.course_id, en.person_id, gi.id, abs(hashtext(en.course_id::text || en.person_id::text)) % 91
from public.enrollments en
join public.courses c on c.id = en.course_id and c.event_id = (select id from public.events where is_current)
join public.grade_items gi on gi.event_id = c.event_id and gi.course_id is null and gi.name = 'Bonus'
where abs(hashtext(en.person_id::text || 'b')) % 3 = 0;
alter table public.grades enable trigger grades_log;

-- ---------------------------------------------------------------------
-- Leaderboard: challenges and points
-- ---------------------------------------------------------------------
insert into public.challenges (event_id, name, kind, individual_max, team_max, visible, sort)
select e.id, x.name, x.kind::public.challenge_kind, x.imax, x.tmax, x.vis, x.sort
from public.events e,
  (values ('Async 1', 'async', 500, 1500, true, 1), ('Async 2', 'async', 500, 1500, true, 2), ('Async 3', 'async', 500, 1500, false, 3),
          ('Event 1', 'live', 50, 500, true, 4), ('Event 2', 'live', 250, 1000, true, 5), ('Event 3', 'live', 750, 2500, true, 6),
          ('Event 4', 'live', 500, 2000, false, 7), ('Event 5', 'live', 1000, 3000, false, 8), ('Event 6', 'live', 400, 800, false, 9))
  as x(name, kind, imax, tmax, vis, sort)
where e.is_current;

insert into public.points (challenge_id, person_id, points)
select ch.id, p.id, (abs(hashtext(ch.id::text || p.id::text)) % (ch.individual_max::int + 1))
from public.challenges ch
join public.people p on p.role = 'student' and p.person_code::text ~ '^27[A-Z]{2}[0-9]{4}$'
where ch.event_id = (select id from public.events where is_current) and ch.visible
  and abs(hashtext(p.id::text || ch.name)) % 3 <> 0;

insert into public.points (challenge_id, team_id, points)
select ch.id, t.id, (abs(hashtext(ch.id::text || t.id::text)) % (ch.team_max::int + 1))
from public.challenges ch
join public.teams t on t.event_id = ch.event_id
where ch.event_id = (select id from public.events where is_current) and ch.visible;

-- ---------------------------------------------------------------------
-- Home Page Content
-- ---------------------------------------------------------------------
insert into public.quick_links (event_id, label, audience, page, url, sort)
select e.id, x.label, x.aud, x.page, x.url, x.sort
from public.events e,
  (values ('Merchandise', 'students', 'merchandise', null, 1), ('Learn', 'both', 'learn', null, 2),
          ('Practice', 'both', null, 'https://practice.sciovirtual.org', 3)) as x(label, aud, page, url, sort)
where e.is_current;

insert into public.reminders (event_id, body, sort)
select e.id, x.body, x.sort from public.events e,
  (values ('Reminder text', 1), ('Reminder text', 2)) as x(body, sort)
where e.is_current;

insert into public.camp_updates (event_id, author_id, title, body, pinned)
select e.id, (select id from public.people where person_code = 'ADM27DA01'), x.title, 'Camp update text', x.pinned
from public.events e, (values ('Update title', true), ('Update title', false)) as x(title, pinned)
where e.is_current;

commit;

-- Setup codes for accounts that haven't signed up yet (admins and
-- instructors first, then the first 20 students)
(select p.person_code as id, p.role, p.first_name || ' ' || p.last_name as name, sc.code as setup_code
 from public.people p join public.setup_codes sc on sc.person_id = p.id and sc.used_at is null
 where p.role <> 'student' order by p.role desc, p.person_code)
union all
(select p.person_code, p.role, p.first_name || ' ' || p.last_name, sc.code
 from public.people p join public.setup_codes sc on sc.person_id = p.id and sc.used_at is null
 where p.role = 'student' order by p.person_code limit 20);
