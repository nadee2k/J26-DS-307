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
  task_type text not null check (task_type in ('reading', 'coding', 'writing', 'zoom', 'assignment')),
  location text check (location in ('home', 'library', 'campus')),
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
create index if not exists vision_logs_session_id_idx on vision_logs (session_id, created_at desc);
create index if not exists concentration_logs_session_id_idx on concentration_logs (session_id, recorded_at desc);

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
alter table vision_logs enable row level security;
alter table concentration_logs enable row level security;
alter table telemetry_streams enable row level security;

drop policy if exists students_public on students;
drop policy if exists study_sessions_public on study_sessions;
drop policy if exists environment_logs_public on environment_logs;
drop policy if exists behavior_logs_public on behavior_logs;
drop policy if exists vision_logs_public on vision_logs;
drop policy if exists concentration_logs_public on concentration_logs;
drop policy if exists telemetry_streams_public on telemetry_streams;

create policy students_public on students for all using (true) with check (true);
create policy study_sessions_public on study_sessions for all using (true) with check (true);
create policy environment_logs_public on environment_logs for all using (true) with check (true);
create policy behavior_logs_public on behavior_logs for all using (true) with check (true);
create policy vision_logs_public on vision_logs for all using (true) with check (true);
create policy concentration_logs_public on concentration_logs for all using (true) with check (true);
create policy telemetry_streams_public on telemetry_streams for all using (true) with check (true);
