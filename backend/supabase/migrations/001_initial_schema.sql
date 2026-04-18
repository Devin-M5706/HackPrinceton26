-- NomaAlert — initial schema
-- Run in the Supabase SQL editor or via supabase db push

create extension if not exists "pgcrypto";

-- ── chws ──────────────────────────────────────────────────────────────────────

create table if not exists chws (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  region       text not null,
  language     text not null check (language in ('hausa', 'french', 'english')),
  auth_token   text not null unique,
  created_at   timestamptz not null default now()
);

-- ── clinics ──────────────────────────────────────────────────────────────────

create table if not exists clinics (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  region        text not null,
  lat           double precision not null,
  lng           double precision not null,
  noma_capable  boolean not null default false,
  contact       text not null default ''
);

-- ── cases ────────────────────────────────────────────────────────────────────

create table if not exists cases (
  id                 uuid primary key default gen_random_uuid(),
  chw_id             uuid not null references chws(id),
  stage              int not null check (stage between 0 and 5),
  risk_score         int not null check (risk_score between 0 and 100),
  triage             text not null check (triage in ('urgent', 'refer', 'monitor', 'healthy')),
  clinical_note      text not null default '',
  referral_note      text not null default '',
  clinic_id          uuid references clinics(id),
  lat                double precision not null default 0,
  lng                double precision not null default 0,
  region             text not null default '',
  child_age_months   int not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists cases_chw_id_idx       on cases(chw_id);
create index if not exists cases_created_at_idx   on cases(created_at desc);
create index if not exists cases_triage_idx        on cases(triage);
create index if not exists cases_region_idx        on cases(region);

-- ── alerts ───────────────────────────────────────────────────────────────────

create table if not exists alerts (
  id           uuid primary key default gen_random_uuid(),
  region       text not null,
  case_count   int not null,
  radius_km    int not null,
  center_lat   double precision not null,
  center_lng   double precision not null,
  fired_at     timestamptz not null default now(),
  notified     boolean not null default false
);

create index if not exists alerts_fired_at_idx on alerts(fired_at desc);

-- ── Row-level security ────────────────────────────────────────────────────────
-- Service-role key bypasses RLS; the orchestrator always uses the service key.
-- Enable RLS anyway as a defence-in-depth measure if the anon key leaks.

alter table cases   enable row level security;
alter table chws    enable row level security;
alter table clinics enable row level security;
alter table alerts  enable row level security;

-- Clinics and alerts are public-read (no personal data)
create policy "clinics_select" on clinics for select using (true);
create policy "alerts_select"  on alerts  for select using (true);

-- CHWs: service role only (backend always uses service key)
-- Cases: same (orchestrator enforces per-CHW filtering in application code)
