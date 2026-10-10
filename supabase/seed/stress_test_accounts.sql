-- STRESS TEST ACCOUNTS for the TEST project only. Never run on the real project.
-- Run test_camp.sql first. Then paste this into the test project's SQL Editor
-- and run it. Safe to run again.
--
-- These 27 accounts are used only by the stress test script
-- (stress-test/load.mjs), never by people, so the tester accounts stay free:
--   * 2 admins:       ADM27LA01, ADM27LB01 ("Load Test A" / "Load Test B")
--   * 5 instructors:  the second instructor of Courses C to G
--   * 20 students:    the last 20 fake students (27..0481 to 27..0500)
--
-- The result lists each account's ID and setup code. Copy the whole result
-- into stress-test/accounts.txt (see stress-test/README.md). Accounts the
-- script has already signed up have no code and are left out.

begin;

insert into public.people (person_code, role, first_name, last_name, email) values
  ('ADM27LA01', 'admin', 'Load Test', 'A', 'loadtest.a@example.com'),
  ('ADM27LB01', 'admin', 'Load Test', 'B', 'loadtest.b@example.com')
on conflict (person_code) do nothing;

commit;

with script_accounts as (
  select p.id, p.person_code, p.role
  from public.people p
  where p.person_code::text in ('ADM27LA01', 'ADM27LB01')
     or p.person_code::text ~ '^CO[C-G]27J[C-G]01$'
     or (p.role = 'student' and p.person_code::text ~ '^27[A-Z]{2}0(48[1-9]|49[0-9]|500)$')
)
select s.person_code as id, s.role, sc.code as setup_code
from script_accounts s
join public.setup_codes sc on sc.person_id = s.id and sc.used_at is null
order by s.role desc, s.person_code;
