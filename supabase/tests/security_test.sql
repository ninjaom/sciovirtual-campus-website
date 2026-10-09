-- Privacy and permission tests. Runs inside one transaction and rolls
-- back, so it leaves nothing behind. Any failed check stops the run.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security_test.sql
begin;

create schema tests;

create function tests.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Run a statement and check it is refused.
create function tests.refused(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok - % (refused: %)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (was allowed)', what;
end $$;

-- Act as a signed-in user (or anon when null) for the rest of the transaction.
create function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  end if;
end $$;
create function tests.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function tests.total(lb jsonb, uname text) returns numeric language sql as $$
  select (r ->> 'total')::numeric from jsonb_array_elements(lb -> 'individual') r where r ->> 'username' = uname
$$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'adm@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'ia@test'),
  ('00000000-0000-0000-0000-0000000000b2', 'ib@test'),
  ('00000000-0000-0000-0000-0000000000c1', 's1@test'),
  ('00000000-0000-0000-0000-0000000000c2', 's2@test'),
  ('00000000-0000-0000-0000-0000000000c3', 's3@test'),
  ('00000000-0000-0000-0000-0000000000f1', 'stranger@test'); -- signed in but no Campus account

insert into public.events (id, name, year, is_current) values ('10000000-0000-0000-0000-000000000001', 'ScioCamp 2027', 2027, true);
insert into public.settings (event_id, leaderboard_state, leaderboard_top_n, course_top_n, takeover_bonus)
values ('10000000-0000-0000-0000-000000000001', 'live', 2, 10, 250);

insert into public.people (id, auth_user_id, person_code, role, first_name, last_name, username, parent_email, email) values
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'ADM27DA01', 'admin', 'Director', 'A', null, null, 'director.a@example.com'),
  ('20000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'COA27IA01', 'instructor', 'Instructor', 'A', null, null, 'ia@example.com'),
  ('20000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'COB27IB01', 'instructor', 'Instructor', 'B', null, null, 'ib@example.com'),
  ('20000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', '27AA0001', 'student', 'First', 'A', 'username_01', 'parent.a@example.com', null),
  ('20000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', '27BB0002', 'student', 'First', 'B', 'username_02', 'parent.b@example.com', null),
  ('20000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3', '27CC0003', 'student', 'First', 'C', 'username_03', 'parent.c@example.com', null),
  -- not signed up yet
  ('20000000-0000-0000-0000-0000000000c4', null, '27DD0004', 'student', 'First', 'D', null, null, null);


insert into public.courses (id, event_id, short_code, name) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'COA', 'Course A'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'COB', 'Course B');
insert into public.course_zoom_hosts values
  ('30000000-0000-0000-0000-00000000000a', 'host.a@example.com', 'secret-a'),
  ('30000000-0000-0000-0000-00000000000b', 'host.b@example.com', 'secret-b');
insert into public.course_staff values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000b1'),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b2');
-- S1 takes A; S2 takes A and B; S3 takes B.
insert into public.enrollments values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c1'),
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c2'),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000c2'),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000c3');

insert into public.teams (id, event_id, number, name) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'Team A'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 2, 'Team B');
insert into public.team_members values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-000000000001');

insert into public.grade_items (id, event_id, name, kind, max_points, points_per_session, sort) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Midpoint', 'manual', 300, null, 1),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Final', 'manual', 340, null, 2),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Attendance', 'attendance', 270, 30, 3),
  ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Bonus', 'manual', 90, null, 4);

-- Sessions are created automatically for each course (9 by default).
insert into public.attendance_codes
select id, 'APPLE' from public.sessions where course_id = '30000000-0000-0000-0000-00000000000a' and number = 1;
insert into public.attendance (session_id, person_id, rating, comment)
select s.id, x.person, x.rating, x.comment
from (values ('30000000-0000-0000-0000-00000000000a'::uuid, 1, '20000000-0000-0000-0000-0000000000c1'::uuid, 9, 's1 comment'),
             ('30000000-0000-0000-0000-00000000000a'::uuid, 2, '20000000-0000-0000-0000-0000000000c1'::uuid, 8, null),
             ('30000000-0000-0000-0000-00000000000a'::uuid, 1, '20000000-0000-0000-0000-0000000000c2'::uuid, 7, 's2 comment')) as x(course, num, person, rating, comment)
join public.sessions s on s.course_id = x.course and s.number = x.num;

-- Scores (as postgres, so the log has no editor)
insert into public.grades (course_id, person_id, grade_item_id, points) values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-000000000001', 280), -- S1 A: 280 + 60 att = 340
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c2', '50000000-0000-0000-0000-000000000001', 200), -- S2 A: 200 + 30 = 230
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000c2', '50000000-0000-0000-0000-000000000001', 250), -- S2 B: 250
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000c3', '50000000-0000-0000-0000-000000000001', 100); -- S3 B: 100

insert into public.challenges (id, event_id, name, kind, individual_max, team_max, visible, sort) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Event 1', 'live', 50, 500, true, 1),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Async 1', 'async', 500, 1500, false, 2);
insert into public.points (challenge_id, person_id, team_id, points) values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c3', null, 50),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000c3', null, 400), -- hidden challenge
  ('70000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000002', 300);

insert into public.announcements (id, course_id, author_id, body) values
  ('80000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000b1', 'Announcement text');
insert into public.reminders (event_id, body) values ('10000000-0000-0000-0000-000000000001', 'Reminder');
insert into public.feedback_results (course_id, kind) values
  ('30000000-0000-0000-0000-00000000000a', 'midpoint'), ('30000000-0000-0000-0000-00000000000b', 'midpoint');

-- ---------------------------------------------------------------------
-- Signed-out visitors
-- ---------------------------------------------------------------------
select tests.as_user(null);
select tests.refused($$select * from public.people$$, 'signed-out visitor cannot read people');
select tests.refused($$select * from public.courses$$, 'signed-out visitor cannot read courses');
select tests.refused($$select public.get_leaderboard()$$, 'signed-out visitor cannot load the leaderboard');

-- ---------------------------------------------------------------------
-- Student S1 (Course A, Team A)
-- ---------------------------------------------------------------------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok((select count(*) from public.people) = 1, 'student reads only their own people row');
select tests.ok((select count(*) from public.people where parent_email = 'parent.b@example.com') = 0, 'student cannot read another student''s parent email');
select tests.ok((select count(*) from public.people_directory where id = '20000000-0000-0000-0000-0000000000c2') = 1, 'student sees a classmate''s name');
select tests.ok((select count(*) from public.people_directory where id = '20000000-0000-0000-0000-0000000000c3') = 0, 'student does not see a non-classmate''s name');
select tests.ok((select count(*) from public.people_directory where role = 'instructor') = 2, 'student sees staff names');
select tests.refused($$update public.people set first_name = 'Hacked' where id = '20000000-0000-0000-0000-0000000000c1'$$, 'student cannot change their own name');
select tests.refused($$update public.people set username = 'new_name' where id = '20000000-0000-0000-0000-0000000000c1'$$, 'student cannot change their username');
update public.people set recovery_email = 'new@example.com' where id = '20000000-0000-0000-0000-0000000000c1';
select tests.ok((select recovery_email from public.people where id = '20000000-0000-0000-0000-0000000000c1') = 'new@example.com', 'student can change their recovery email');
update public.people set recovery_email = 'x@example.com' where id = '20000000-0000-0000-0000-0000000000c2';
select tests.ok((select count(*) from public.people where recovery_email = 'x@example.com') = 0, 'student cannot change someone else''s row');

select tests.ok((select count(*) from public.course_zoom_hosts) = 0, 'student cannot read any Zoom host credentials');
select tests.ok((select count(*) from public.setup_codes) = 0, 'student cannot read setup codes');
select tests.ok((select count(*) from public.courses) = 1, 'student sees only their own courses');
select tests.ok((select count(*) from public.grades) = 1, 'student reads only their own grades');
select tests.ok((select count(*) from public.grades where person_id = '20000000-0000-0000-0000-0000000000c2') = 0, 'student cannot read another student''s grades');
select tests.refused($$insert into public.grades (course_id, person_id, grade_item_id, points) values ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-000000000004', 90)$$, 'student cannot enter grades');
update public.grades set points = 300 where person_id = '20000000-0000-0000-0000-0000000000c1';
select tests.ok((select points from public.grades where person_id = '20000000-0000-0000-0000-0000000000c1') = 280, 'student cannot change their own grade');
select tests.ok((select count(*) from public.grade_edits) = 0, 'student cannot read the edit log');
select tests.ok((select count(*) from public.attendance) = 2, 'student reads only their own attendance');
select tests.ok((select count(*) from public.attendance_codes) = 0, 'student cannot read attendance codes');
select tests.ok((select count(*) from public.points) = 0, 'student cannot read raw points');
select tests.ok((select count(*) from public.leaderboard_snapshots) = 0, 'student cannot read snapshots directly');
select tests.ok((select count(*) from public.reminders) = 0, 'student cannot read instructor reminders');
select tests.ok((select count(*) from public.feedback_results) = 0, 'student cannot read feedback results');
select tests.ok((select count(*) from public.team_members) = 1, 'student reads only their own team membership');
select tests.ok((select count(*) from public.announcements) = 1, 'student reads their course''s announcements');
select tests.refused($$insert into public.announcements (course_id, author_id, body) values ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c1', 'x')$$, 'student cannot post an announcement');
insert into public.announcement_comments (announcement_id, author_id, body) values ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', 'Student comment');
select tests.ok((select count(*) from public.announcement_comments) = 1, 'student can comment in their course');
select tests.refused($$insert into public.announcement_comments (announcement_id, author_id, body) values ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c2', 'pretend')$$, 'student cannot comment as someone else');
select tests.refused($$select public.compute_leaderboard(public.current_event())$$, 'student cannot call the internal leaderboard function');
select tests.refused($$select * from public.course_scores(public.current_event())$$, 'student cannot call the internal score function');
-- Photos: own folder only
insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000c1/me.png');
select tests.refused($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000c2/me.png')$$, 'student cannot upload into someone else''s photo folder');

-- Leaderboard while live (top_n = 2 for the test)
select tests.ok(public.get_leaderboard() ->> 'state' = 'live', 'leaderboard is live');
select tests.ok(public.get_leaderboard()::text not like '%person_id%' and public.get_leaderboard()::text not like '%First%', 'leaderboard has no ids or real names');
select tests.ok(jsonb_array_length(public.get_leaderboard() -> 'individual') = 2, 'leaderboard lists only the top N');
-- S1: one course 340 -> 340, 255, 170 = 765 (rank 1); S2: 250 + 230 + avg 240 = 720 (rank 2); S3: 100, 75, 50 + 50 = 275 (rank 3)
select tests.ok((public.get_leaderboard() -> 'individual' -> 0 ->> 'total')::numeric = 765, 'one-course extrapolation: x0.75 and x0.50');
select tests.ok((public.get_leaderboard() -> 'individual' -> 1 ->> 'total')::numeric = 720, 'two-course extrapolation: average of the two');
select tests.ok((public.get_leaderboard() -> 'individual' -> 0 ->> 'is_me')::boolean, 'student is marked on their own row');
select tests.ok((public.get_my_standing() ->> 'rank')::int = 1 and (public.get_my_standing() ->> 'of')::int = 3, 'home standing counts the whole camp');

-- S3 is below the cutoff of 2 but still sees their own row
select tests.as_user('00000000-0000-0000-0000-0000000000c3');
select tests.ok((public.get_leaderboard() -> 'me_below_cutoff' ->> 'rank')::int = 3, 'student below the cutoff sees their own rank');
select tests.ok((public.get_leaderboard() -> 'me_below_cutoff' ->> 'total')::numeric = 275, 'hidden challenges do not count');
select tests.ok((select count(*) from public.announcements) = 0, 'student cannot read another course''s announcements');
-- Teams: Team A has both course top scorers (S1 in A with 340, S2 in B with 250) -> 500 takeover; Team B 300 event points
select tests.ok((public.get_leaderboard() -> 'teams' -> 0 ->> 'name') = 'Team A' and (public.get_leaderboard() -> 'teams' -> 0 ->> 'total')::numeric = 500, 'course takeover bonus goes to the top scorer''s team');

-- ---------------------------------------------------------------------
-- Instructor A (teaches Course A)
-- ---------------------------------------------------------------------
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.course_zoom_hosts) = 1 and (select course_id from public.course_zoom_hosts) = '30000000-0000-0000-0000-00000000000a', 'instructor reads only their own course''s Zoom host');
select tests.ok((select count(*) from public.people where role = 'student') = 2, 'instructor reads their own students only');
select tests.ok((select count(*) from public.people where id = '20000000-0000-0000-0000-0000000000c3') = 0, 'instructor cannot read a student outside their course');
select tests.ok((select count(*) from public.grades where course_id = '30000000-0000-0000-0000-00000000000b') = 0, 'instructor cannot read another course''s grades');
select tests.ok((select count(*) from public.setup_codes) = 0, 'instructor cannot read setup codes');
insert into public.grades (course_id, person_id, grade_item_id, points) values ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-000000000004', 80);
select tests.ok((select count(*) from public.grade_edits where new_points = 80 and edited_by = '20000000-0000-0000-0000-0000000000b1') = 1, 'grade edits are logged with the editor');
update public.grades set points = 85 where grade_item_id = '50000000-0000-0000-0000-000000000004' and person_id = '20000000-0000-0000-0000-0000000000c1';
select tests.ok((select count(*) from public.grade_edits where old_points = 80 and new_points = 85) = 1, 'changes log the old and new value');
select tests.refused($$update public.grades set points = 95 where grade_item_id = '50000000-0000-0000-0000-000000000004' and person_id = '20000000-0000-0000-0000-0000000000c1'$$, 'scores above the maximum are refused');
select tests.refused($$insert into public.grades (course_id, person_id, grade_item_id, points) values ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-000000000003', 30)$$, 'attendance points cannot be typed in');
select tests.refused($$insert into public.grades (course_id, person_id, grade_item_id, points) values ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000c3', '50000000-0000-0000-0000-000000000004', 10)$$, 'instructor cannot grade a student not in the course');
select tests.refused($$insert into public.grades (course_id, person_id, grade_item_id, points) values ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000c2', '50000000-0000-0000-0000-000000000004', 10)$$, 'instructor cannot grade in another course');
select tests.ok((select count(*) from public.attendance where comment is not null) = 2, 'instructor reads their course''s attendance comments');
select tests.ok((select count(*) from public.attendance_codes) = 1, 'instructor reads their course''s attendance codes');
select tests.ok((select count(*) from public.feedback_results) = 1, 'instructor reads only their own class''s feedback');
select tests.ok((select count(*) from public.reminders) = 1, 'instructor reads reminders');
select tests.ok((select count(*) from public.people where role = 'instructor') = 1, 'instructor does not read another course''s instructor');
delete from public.announcement_comments;
select tests.ok((select count(*) from public.announcement_comments) = 0, 'instructor can remove comments in their course');
update public.settings set leaderboard_state = 'frozen';
select tests.ok((select leaderboard_state from public.settings) = 'live', 'instructor cannot freeze the leaderboard');

-- ---------------------------------------------------------------------
-- A sign-in with no Campus account sees nothing
-- ---------------------------------------------------------------------
select tests.as_user('00000000-0000-0000-0000-0000000000f1');
select tests.ok((select count(*) from public.settings) = 0 and (select count(*) from public.teams) = 0 and (select count(*) from public.events) = 0, 'a sign-in without a Campus account reads nothing');
select tests.ok(public.get_leaderboard() is null, 'a sign-in without a Campus account gets no leaderboard');
select tests.refused($$select public.admin_new_setup_code('20000000-0000-0000-0000-0000000000c4')$$, 'non-admins cannot issue setup codes');

-- ---------------------------------------------------------------------
-- Admin: freezing and hiding
-- ---------------------------------------------------------------------
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select count(*) from public.people) = 7, 'admin reads everyone');
select tests.ok((select count(*) from public.setup_codes) = 1, 'new people get a setup code automatically');
select tests.ok((select code from public.setup_codes) ~ '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$', 'setup codes use the XXXX-XXXX format');
select tests.ok(public.admin_new_setup_code('20000000-0000-0000-0000-0000000000c4') <> '' and (select count(*) from public.setup_codes where used_at is null) = 1, 'admin can issue a new code, replacing the old one');
select tests.ok((select count(*) from public.course_zoom_hosts) = 2, 'admin reads all Zoom hosts');
update public.settings set leaderboard_state = 'frozen';
insert into public.points (challenge_id, person_id, points) values ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c2', 50);
select tests.ok(tests.total(public.get_leaderboard(), 'username_02') = 770, 'admin sees live standings while frozen');

select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok(public.get_leaderboard() ->> 'state' = 'frozen', 'student sees frozen state');
select tests.ok(tests.total(public.get_leaderboard(), 'username_02') = 720, 'student sees the snapshot, not points entered while frozen');

select tests.as_user('00000000-0000-0000-0000-0000000000a1');
update public.settings set leaderboard_state = 'hidden';
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok(public.get_leaderboard() = '{"state": "hidden"}'::jsonb, 'student sees nothing while hidden');
select tests.ok(public.get_my_standing() ->> 'state' = 'hidden' and public.get_my_standing() -> 'rank' is null, 'home standing hidden too');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok(jsonb_array_length(public.get_leaderboard() -> 'individual') = 3, 'admin still sees the full leaderboard while hidden');
update public.settings set leaderboard_state = 'live';
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok(tests.total(public.get_leaderboard(), 'username_02') = 770, 'unfreezing publishes everything at once');

-- ---------------------------------------------------------------------
-- Phase 2: admin basics
-- ---------------------------------------------------------------------
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok((select count(*) from public.activity_log) = 0, 'student cannot read the activity log');
select tests.refused($$select public.admin_overview()$$, 'student cannot load the admin overview');
select tests.refused($$select public.next_person_code('COA', 'A', 'B')$$, 'student cannot generate IDs');
select tests.refused($$insert into public.quick_links (event_id, label, page) values (public.current_event(), 'x', 'learn')$$, 'student cannot add quick links');
select tests.refused($$select public.admin_set_course_override('30000000-0000-0000-0000-00000000000a', true)$$, 'student cannot override grade items');

select tests.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.quick_links (event_id, label, page, audience) values (public.current_event(), 'Learn', 'learn', 'both');
select tests.ok(exists (select 1 from public.activity_log where action = 'Entered points · Event 1 · Students'), 'entering points is logged');
select tests.ok(public.next_person_code('COA', 'Instructor', 'A') = 'COA27IA02', 'instructor IDs: code + year + initials + next number');
select tests.ok(public.next_person_code('ADM', 'Om', 'Loke') = 'ADM27OL01', 'admin IDs use the prefix');
select tests.refused($$delete from public.courses where id = '30000000-0000-0000-0000-00000000000a'$$, 'a course with students cannot be deleted');
select tests.ok((public.admin_overview() ->> 'students')::int = 3 and (public.admin_overview() ->> 'courses')::int = 2, 'overview counts students and courses');
select tests.ok(jsonb_array_length(public.admin_overview() -> 'activity') > 0, 'overview shows recent activity');
update public.settings set courses_that_count = 2;
select tests.ok(tests.total(public.get_leaderboard(), 'username_01') = 425 + 318.75, 'courses that count is a setting');
update public.settings set courses_that_count = 3, sessions_per_course = 3;
select tests.ok((select count(*) from public.sessions where course_id = '30000000-0000-0000-0000-00000000000b') = 3, 'sessions per course follows the setting');
select tests.ok((select max_points from public.grade_items where kind = 'attendance' and course_id is null) = 90, 'attendance maximum follows sessions');
select public.admin_set_course_override('30000000-0000-0000-0000-00000000000b', true);
select tests.ok((select count(*) from public.grade_items where course_id = '30000000-0000-0000-0000-00000000000b') = 4, 'override starts from a copy of the shared items');
select public.admin_set_course_override('30000000-0000-0000-0000-00000000000b', false);
select tests.ok((select count(*) from public.grade_items where course_id = '30000000-0000-0000-0000-00000000000b') = 0, 'override can be turned off before any scores');
update public.grade_items set max_points = 250 where name = 'Midpoint' and course_id is null;
select tests.ok((select count(*) from public.admin_scores_over_max()) = 1, 'scores above a lowered maximum are listed');

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok((select count(*) from public.quick_links) = 1, 'signed-in people read quick links');
select tests.ok((select count(*) from public.admin_scores_over_max()) = 0, 'students get nothing from the over-maximum list');

select tests.as_postgres();
rollback;
