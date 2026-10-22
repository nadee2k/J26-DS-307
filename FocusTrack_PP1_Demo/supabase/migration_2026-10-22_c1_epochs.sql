-- FocusTrack PP1 migration: Component 1 epoch storage (run once in the Supabase SQL editor).
-- Fresh installs: run schema.sql instead, which already contains this table.
--
-- Only numeric per-epoch features are stored. Raw key/mouse events, key characters, text,
-- window titles and mouse coordinates are never written to the database.

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

create index if not exists c1_epochs_student_id_idx on c1_epochs (student_id, recorded_at desc);
create index if not exists c1_epochs_session_id_idx on c1_epochs (session_id, recorded_at desc);

alter table c1_epochs enable row level security;
drop policy if exists c1_epochs_public on c1_epochs;
-- development only – replace with participant-scoped policies before real data collection
create policy c1_epochs_public on c1_epochs for all using (true) with check (true);
