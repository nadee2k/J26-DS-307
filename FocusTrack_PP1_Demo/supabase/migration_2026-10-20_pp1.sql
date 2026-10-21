-- FocusTrack PP1 migration for an existing database (run once in the Supabase SQL editor).
-- Fresh installs: run schema.sql instead, which already contains these changes.

-- Study mode is recorded per session (not per person); handwriting is a non-screen task.
alter table study_sessions drop constraint if exists study_sessions_task_type_check;
alter table study_sessions add constraint study_sessions_task_type_check
  check (task_type in ('reading', 'handwriting', 'coding', 'writing', 'zoom', 'assignment'));
-- The app allows a free-text place when "other" is chosen.
alter table study_sessions drop constraint if exists study_sessions_location_check;
alter table study_sessions add column if not exists study_mode text check (study_mode in ('screen', 'non-screen'));
alter table study_sessions add column if not exists session_rating integer check (session_rating between 1 and 5);
alter table study_sessions add column if not exists active_seconds integer;

-- Component 3: personal three-zone gaze calibration and its held-out scripted check.
create table if not exists calibrations (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  student_id uuid not null references students(id) on delete cascade,
  quick boolean not null default false,
  model jsonb not null,
  desk_anchor double precision,
  screen_pitch double precision,
  n_train integer,
  n_test integer,
  accuracy_personal double precision,
  accuracy_fixed double precision,
  phone_recall double precision,
  phone_frames integer,
  reading_motion_read double precision,
  reading_motion_phone double precision,
  per_zone jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists calibrations_student_id_idx on calibrations (student_id, created_at);
alter table calibrations enable row level security;
drop policy if exists calibrations_public on calibrations;
-- development only – replace with participant-scoped policies before real data collection
create policy calibrations_public on calibrations for all using (true) with check (true);

-- PP1: prototype feedback (System Usability Scale + open questions), no personal identifiers
create table if not exists prototype_feedback (
  id uuid primary key default gen_random_uuid(),
  part text not null,
  role text,
  sus integer[] not null,
  liked text,
  change text,
  privacy text,
  created_at timestamptz not null default timezone('utc', now())
);
alter table prototype_feedback enable row level security;
drop policy if exists prototype_feedback_public on prototype_feedback;
create policy prototype_feedback_public on prototype_feedback for all using (true) with check (true);
