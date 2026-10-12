# Stress test (test project only)

A simulated busy camp day: 500 students, 31 instructors and 5 admins using
Campus at once for 10 minutes. Students move between Home, the Leaderboard,
their course pages and Merchandise. Twice during the run a class "ends" and
every student opens the leaderboard within 15 seconds. Instructors enter
scores and admins enter points the whole time.

The script reuses 27 accounts of its own (2 admins, 5 instructors and 20
students), so the tester accounts stay free. It refuses to run against the
real project, checks that the current event is "ScioCamp 2027 (test)", and
puts back every score and point it changes when it finishes, even if you
stop it early.

## One-time setup (about 10 minutes)

1. Install Node 18 or newer (https://nodejs.org, the LTS version).
2. Get this repository on your computer (GitHub Desktop: Fetch origin, then
   Pull origin, so you have the latest version).
3. In the test project's SQL Editor, run `supabase/seed/stress_test_accounts.sql`
   and download the result as CSV. Put it in the `stress-test` folder named
   `accounts.csv` (it's never committed).
4. Open a terminal in the repository folder (GitHub Desktop: Repository →
   Open in Terminal) and run `node stress-test/load.mjs setup`.
   The first time, it asks for the test project's publishable key
   (Supabase → test project → Project Settings → API Keys, starts with
   `sb_publishable_`) and saves it in `stress-test/config.json`. Never use
   the secret key. It then signs up the 27 accounts through the test site
   with passwords it makes up and keeps in `stress-test/.accounts.json`
   (never committed), and ends with "27 of 27 accounts can sign in".

## The run (10 minutes)

1. Open the test project in Supabase in your browser: Reports → API, and
   Database (CPU / memory). Note the time.
2. Run `node stress-test/load.mjs run`.
   Every 15 seconds it prints a status line: requests per second, how slow
   the slowest responses are, how many are waiting, and errors.
   Ctrl+C stops early; the summary and clean-up still happen.
3. When it finishes it prints a summary between two `=====` lines and saves
   it as `stress-test/results-<date>.txt`. Paste the summary to Claude,
   with what the Supabase reports showed during the run (CPU, memory,
   anything in red).

If a run was cut off before cleaning up (computer slept, terminal closed),
run `node stress-test/load.mjs restore`.

Options: `--minutes 5`, `--students 200`, `--instructors 31`, `--admins 5`,
`--connections 100` (how many connections this computer may open at once).

The summary splits each request's time into waiting on this computer and
the server's part, sorts errors by kind (this computer/network vs. the
server), and includes a probe: one tiny request every 5 seconds on its own
connection, which shows how quickly the server answers when nothing on
this computer is in the way.

## Good to know

- Data use: roughly 150 to 300 MB of the test project's monthly 5 GB per
  10-minute run (the Supabase usage page shows the real figure).
- While it runs, scores in Courses C to G and some event points move up or
  down by 1 and are then put back. These edits show in those courses'
  Scores edit log, by the "Load Test" accounts.
  Running `test_camp.sql` again clears them.
- Don't run it while testers are using the test site.
