-- Campus core tables. See "Data model" in the planning doc.
-- Row-level security is switched on for every table here; the rules
-- themselves are in the security migration.

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.role as enum ('student', 'instructor', 'admin');
create type public.leaderboard_state as enum ('live', 'frozen', 'hidden');
create type public.challenge_kind as enum ('live', 'async', 'revenge');
create type public.grade_item_kind as enum ('manual', 'attendance');
create type public.feedback_kind as enum ('midpoint', 'final');
create type public.post_type as enum ('guide', 'post');

-- ---------------------------------------------------------------------
-- Events: a camp (or a future event). Everything below belongs to one.
-- ---------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year int not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
-- Only one event can be the current one.
create unique index events_one_current on public.events (is_current) where is_current;

create table public.settings (
  event_id uuid primary key references public.events (id) on delete cascade,
  leaderboard_state public.leaderboard_state not null default 'hidden',
  leaderboard_top_n int not null default 350 check (leaderboard_top_n > 0),
  course_top_n int not null default 10 check (course_top_n > 0),
  credits_per_point numeric not null default 1 check (credits_per_point >= 0),
  takeover_bonus int not null default 250 check (takeover_bonus >= 0),
  admin_id_prefix text not null default 'ADM',
  first_day date,
  daily_principles text[] not null default '{}',
  faq_url text,
  attendance_url text,
  merch_ready boolean not null default false,
  merch_student_form_url text,
  merch_instructor_form_url text,
  merch_recommendation_form_url text,
  past_slides_folder_url text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- People: students, instructors and admins.
-- ---------------------------------------------------------------------
create table public.people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  person_code extensions.citext not null unique, -- the ID people sign in with, e.g. 27AA0001
  role public.role not null,
  first_name text not null,
  last_name text not null,
  username extensions.citext unique, -- students only; set once at sign-up
  avatar_path text,
  recovery_email text, -- used only for password resets
  -- Roster details (students)
  grade int,
  school text,
  city text,
  state text,
  student_email text,
  parent_email text,
  -- Staff contact (instructors, admins)
  email text,
  signed_up_at timestamptz,
  created_at timestamptz not null default now(),
  constraint username_students_only check (username is null or role = 'student'),
  constraint username_format check (username is null or username ~ '^[A-Za-z0-9_.]{3,24}$')
);
create index people_role_idx on public.people (role);

-- One-time codes for first sign-up and admin password resets.
create table public.setup_codes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  code text not null,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
-- At most one unused code per person.
create unique index setup_codes_one_open on public.setup_codes (person_id) where used_at is null;

-- Failed sign-up attempts, for rate limiting setup-code guesses.
create table public.signup_attempts (
  id bigint generated always as identity primary key,
  person_code text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index signup_attempts_code_at on public.signup_attempts (person_code, at);

-- ---------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  short_code extensions.citext not null,
  name text not null,
  time_slot text, -- e.g. "1–2 PM ET"
  days text, -- e.g. "Mon, Wed, Fri"
  zoom_join_url text,
  archived boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, short_code)
);

-- Zoom host credentials: only that course's instructors and admins can read.
create table public.course_zoom_hosts (
  course_id uuid primary key references public.courses (id) on delete cascade,
  host_email text,
  host_password text
);

create table public.course_staff (
  course_id uuid not null references public.courses (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  primary key (course_id, person_id)
);
create index course_staff_person on public.course_staff (person_id);

create table public.enrollments (
  course_id uuid not null references public.courses (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  primary key (course_id, person_id)
);
create index enrollments_person on public.enrollments (person_id);

-- ---------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number int,
  name text not null,
  counselors text,
  unique (event_id, name)
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  primary key (team_id, person_id),
  unique (event_id, person_id) -- one team per person per event
);

-- ---------------------------------------------------------------------
-- Sessions and attendance
-- ---------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  number int not null check (number > 0),
  date date,
  unique (course_id, number)
);

create table public.attendance_codes (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  code text not null
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  rating int check (rating between 1 and 10),
  comment text,
  submitted_at timestamptz not null default now(),
  fixed_by uuid references public.people (id) on delete set null, -- set when an admin adds a missed check-in
  unique (session_id, person_id)
);

-- ---------------------------------------------------------------------
-- Grades
-- ---------------------------------------------------------------------
-- Grade items: one shared set per event (course_id null), or a single
-- course's own set when admins override it (course_id set).
create table public.grade_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  name text not null,
  kind public.grade_item_kind not null default 'manual',
  max_points numeric not null check (max_points >= 0), -- for attendance: the total across all sessions
  points_per_session numeric check (points_per_session >= 0), -- attendance only
  sort int not null default 0,
  constraint attendance_has_rate check (kind <> 'attendance' or points_per_session is not null)
);

create table public.grades (
  course_id uuid not null references public.courses (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  grade_item_id uuid not null references public.grade_items (id) on delete cascade,
  points numeric not null check (points >= 0),
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (course_id, person_id, grade_item_id)
);

create table public.grade_edits (
  id bigint generated always as identity primary key,
  course_id uuid not null references public.courses (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  grade_item_id uuid not null references public.grade_items (id) on delete cascade,
  old_points numeric,
  new_points numeric,
  edited_by uuid references public.people (id) on delete set null,
  edited_at timestamptz not null default now()
);
create index grade_edits_course on public.grade_edits (course_id, edited_at desc);

-- ---------------------------------------------------------------------
-- Leaderboard: challenges and points
-- ---------------------------------------------------------------------
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  kind public.challenge_kind not null,
  individual_max numeric check (individual_max >= 0), -- null = no individual points
  team_max numeric check (team_max >= 0), -- null = no team points
  visible boolean not null default true,
  sort int not null default 0
);

create table public.points (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  person_id uuid references public.people (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  points numeric not null,
  entered_by uuid references public.people (id) on delete set null,
  entered_at timestamptz not null default now(),
  constraint one_target check ((person_id is null) <> (team_id is null))
);
create unique index points_person on public.points (challenge_id, person_id) where person_id is not null;
create unique index points_team on public.points (challenge_id, team_id) where team_id is not null;

-- Published standings shown to students while the leaderboard is frozen.
create table public.leaderboard_snapshots (
  event_id uuid primary key references public.events (id) on delete cascade,
  taken_at timestamptz not null default now(),
  individual jsonb not null,
  teams jsonb not null,
  courses jsonb not null
);

-- ---------------------------------------------------------------------
-- Announcements, camp updates, reminders
-- ---------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  author_id uuid references public.people (id) on delete set null,
  body text not null,
  attachments jsonb not null default '[]',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index announcements_course on public.announcements (course_id, created_at desc);

create table public.announcement_comments (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  author_id uuid references public.people (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index announcement_comments_post on public.announcement_comments (announcement_id, created_at);

-- Director posts on Home (no comments).
create table public.camp_updates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  author_id uuid references public.people (id) on delete set null,
  title text not null,
  body text not null,
  attachments jsonb not null default '[]',
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

-- Important Reminders: director notes shown to instructors only.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  author_id uuid references public.people (id) on delete set null,
  body text not null,
  urgent boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Feedback (imported from Google Forms)
-- ---------------------------------------------------------------------
create table public.feedback_results (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  kind public.feedback_kind not null,
  questions jsonb not null default '[]', -- [{question, average, camp_average}]
  comments jsonb not null default '[]', -- [{question, answers: [text]}]
  responses int not null default 0,
  imported_at timestamptz not null default now(),
  unique (course_id, kind)
);

-- ---------------------------------------------------------------------
-- Learn, Past Resources, Merchandise
-- ---------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  type public.post_type not null,
  section text, -- Learn section heading
  body text not null default '', -- Markdown
  author_id uuid references public.people (id) on delete set null,
  author_name text, -- for migrated guides without a Campus account
  archived boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.past_resources (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  course_name text not null,
  title text not null,
  url text not null,
  sort int not null default 0
);

create table public.merch_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  credit_cost int not null check (credit_cost >= 0),
  image_path text,
  visible boolean not null default true,
  sort int not null default 0
);

-- ---------------------------------------------------------------------
-- Row-level security on for every table (rules in the next migration).
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
