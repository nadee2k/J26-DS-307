-- FocusTrack schema for Supabase Postgres + PostgREST
-- Run this in the Supabase SQL Editor (once per project).

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age integer not null,
  gender text not null check (gender in ('male', 'female')),
  university text,
  faculty text,
  degree text,
  learning_type text check (learning_type in ('screen', 'non-screen')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists study_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  task_type text not null check (task_type in ('reading', 'handwriting', 'coding', 'writing', 'zoom', 'assignment')),
  study_mode text check (study_mode in ('screen', 'non-screen')), -- chosen per session, not per person
  location text, -- 'home', 'library', 'campus' or a free-text place
  session_rating integer check (session_rating between 1 and 5), -- end-of-session focus rating
  active_seconds integer, -- study time excluding pauses
  expected_duration integer,
  status text not null default 'idle' check (status in ('idle', 'running', 'paused', 'completed')),
  started_at timestamptz,
  paused_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists environment_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references study_sessions(id) on delete cascade,
  temperature double precision,
  humidity double precision,
  light integer,
  noise integer,
  motion boolean,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists behavior_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references study_sessions(id) on delete cascade,
  keyboard_count integer not null default 0,
  mouse_distance double precision not null default 0,
  mouse_clicks integer not null default 0,
  idle_time double precision not null default 0,
  active_application text,
  created_at timestamptz not null default timezone('utc', now())
);

-- Component 1: one numeric feature epoch at a time. Raw key/mouse events are never stored.
create table if not exists c1_epochs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  session_id uuid references study_sessions(id) on delete set null,
  recorded_at timestamptz not null default timezone('utc', now()),
  study_mode text,
  task_type text,
  epoch_seconds integer not null default 60,
  source text not null default 'desktop' check (source in ('desktop', 'browser')),
  active_application text,
  typing_rate double precision not null default 0,
  inter_key_var double precision not null default 0,
  backspace_ratio double precision not null default 0,
  idle_ratio double precision not null default 0,
  mouse_speed double precision not null default 0,
  switch_rate double precision not null default 0,
  scroll_rate double precision not null default 0,
  keyboard_active boolean not null default false,
  interaction_state integer not null default 0,
  state_label text,
  dwell integer not null default 1,
  changes integer not null default 0,
  away_share double precision not null default 0,
  focus_prob double precision,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists vision_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references study_sessions(id) on delete cascade,
  face_detected boolean,
  eye_gaze text,
  head_direction text,
  phone_detected boolean,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists concentration_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references study_sessions(id) on delete cascade,
  level integer not null check (level between 1 and 5),
  environment text not null check (environment in ('campus', 'house', 'study-area', 'library', 'public')),
  notes text,
  recorded_at timestamptz not null default timezone('utc', now())
);

-- Component 3: personal three-zone gaze calibration and its held-out scripted check
create table if not exists calibrations (
  id uuid primary key default gen_random_uuid(),
  session_id text, -- study session id, or a workbench run id
  student_id uuid not null references students(id) on delete cascade,
  quick boolean not null default false,
  model jsonb not null, -- multinomial logistic weights (no images)
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

create table if not exists telemetry_streams (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  state text not null default 'INACTIVE' check (state in ('ACTIVE', 'INACTIVE', 'STANDBY'))
);

drop trigger if exists students_set_updated_at on students;
create trigger students_set_updated_at
before update on students
for each row execute function set_updated_at();

drop trigger if exists study_sessions_set_updated_at on study_sessions;
create trigger study_sessions_set_updated_at
before update on study_sessions
for each row execute function set_updated_at();

create index if not exists study_sessions_student_id_idx on study_sessions (student_id, created_at desc);
create index if not exists environment_logs_session_id_idx on environment_logs (session_id, created_at desc);
create index if not exists behavior_logs_session_id_idx on behavior_logs (session_id, created_at desc);
create index if not exists c1_epochs_student_id_idx on c1_epochs (student_id, recorded_at desc);
create index if not exists c1_epochs_session_id_idx on c1_epochs (session_id, recorded_at desc);
create index if not exists vision_logs_session_id_idx on vision_logs (session_id, created_at desc);
create index if not exists concentration_logs_session_id_idx on concentration_logs (session_id, recorded_at desc);
create index if not exists calibrations_student_id_idx on calibrations (student_id, created_at);

insert into telemetry_streams (label, state)
select seed.label, 'INACTIVE'
from (
  values
    ('ESP32 Sensor Stream'),
    ('Behavior Logger'),
    ('Vision Logger (Camera)')
) as seed(label)
where not exists (
  select 1 from telemetry_streams t where t.label = seed.label
);

-- Matches the current FastAPI app: no login, open write for data collection.
alter table students enable row level security;
alter table study_sessions enable row level security;
alter table environment_logs enable row level security;
alter table behavior_logs enable row level security;
alter table c1_epochs enable row level security;
alter table vision_logs enable row level security;
alter table concentration_logs enable row level security;
alter table telemetry_streams enable row level security;
alter table calibrations enable row level security;

drop policy if exists students_public on students;
drop policy if exists study_sessions_public on study_sessions;
drop policy if exists environment_logs_public on environment_logs;
drop policy if exists behavior_logs_public on behavior_logs;
drop policy if exists c1_epochs_public on c1_epochs;
drop policy if exists vision_logs_public on vision_logs;
drop policy if exists concentration_logs_public on concentration_logs;
drop policy if exists telemetry_streams_public on telemetry_streams;
drop policy if exists calibrations_public on calibrations;

create policy students_public on students for all using (true) with check (true);
create policy study_sessions_public on study_sessions for all using (true) with check (true);
create policy environment_logs_public on environment_logs for all using (true) with check (true);
create policy behavior_logs_public on behavior_logs for all using (true) with check (true);
create policy c1_epochs_public on c1_epochs for all using (true) with check (true);
create policy vision_logs_public on vision_logs for all using (true) with check (true);
create policy concentration_logs_public on concentration_logs for all using (true) with check (true);
create policy telemetry_streams_public on telemetry_streams for all using (true) with check (true);
create policy calibrations_public on calibrations for all using (true) with check (true);

-- WARNING: the open policies above are for development only. Before real data collection, replace them with
-- policies scoped to an authenticated participant or a server-side role (see DEMO_MODE.md).

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
