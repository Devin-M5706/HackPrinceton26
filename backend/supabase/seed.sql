-- lumos.health seed data — local development and demo
--
-- Tokens are stored as SHA-256 digests. The plaintext values below are for
-- local development only and must never be used in a deployed environment.
--
--   Amina Musa        chw-token-amina
--   Jean-Pierre Koné  chw-token-jean
--   Grace Okafor      chw-token-supervisor   (role: supervisor)
--
-- Run after the migrations:  psql "$DATABASE_URL" -f supabase/seed.sql

-- ── CHWs ─────────────────────────────────────────────────────────────────────

insert into chws (id, name, region, language, role, auth_token_hash) values
  ('11111111-0000-0000-0000-000000000001', 'Amina Musa',       'zinder', 'hausa',   'chw',
   encode(digest('chw-token-amina', 'sha256'), 'hex')),
  ('11111111-0000-0000-0000-000000000002', 'Jean-Pierre Koné', 'maradi', 'french',  'chw',
   encode(digest('chw-token-jean', 'sha256'), 'hex')),
  ('11111111-0000-0000-0000-000000000003', 'Grace Okafor',     'zinder', 'english', 'supervisor',
   encode(digest('chw-token-supervisor', 'sha256'), 'hex'))
on conflict (id) do nothing;

-- ── Clinics ──────────────────────────────────────────────────────────────────

insert into clinics (id, name, region, lat, lng, noma_capable, contact) values
  ('22222222-0000-0000-0000-000000000001', 'Zinder National Hospital',       'zinder', 13.8069, 8.9881, true,  '+227 20 51 23 45'),
  ('22222222-0000-0000-0000-000000000002', 'Maradi Regional Medical Centre', 'maradi', 13.5006, 7.0977, true,  '+227 20 41 12 33'),
  ('22222222-0000-0000-0000-000000000003', 'Niamey National Hospital',       'niamey', 13.5137, 2.1098, true,  '+227 20 72 25 21'),
  ('22222222-0000-0000-0000-000000000004', 'Agadez District Health Centre',  'agadez', 16.9742, 7.9989, false, '+227 20 44 00 44')
on conflict (id) do nothing;

-- ── Cases ────────────────────────────────────────────────────────────────────
-- Three cases within ~8 km of Zinder (13.79°N, 9.00°E), which is inside the
-- surveillance agent's 10 km clustering radius and at its 3-case threshold, so
-- the next poll raises an outbreak alert.

insert into cases (
  id, chw_id, stage, risk_score, triage,
  clinical_note, referral_note, clinic_id,
  lat, lng, region, child_age_months, created_at
) values
  (
    '33333333-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    3, 74, 'urgent',
    'Stage 3 Noma with active necrosis on left cheek. Child is 28 months, severely malnourished.',
    'An aika yaro zuwa asibitin Zinder nan da nan. Yana bukatar maganin rigakafi da kulawa na musamman.',
    '22222222-0000-0000-0000-000000000001',
    13.82, 9.01, 'zinder', 28, now() - interval '3 days'
  ),
  (
    '33333333-0000-0000-0000-000000000002',
    '11111111-0000-0000-0000-000000000001',
    2, 55, 'refer',
    'Stage 2 Noma with perioral oedema and early tissue involvement. Child is 19 months.',
    'Refer to Zinder Hospital for antibiotic treatment and nutritional support.',
    '22222222-0000-0000-0000-000000000001',
    13.79, 8.98, 'zinder', 19, now() - interval '5 days'
  ),
  (
    '33333333-0000-0000-0000-000000000003',
    '11111111-0000-0000-0000-000000000002',
    3, 80, 'urgent',
    'Stage 3 Noma. Extensive cheek necrosis. Child 36 months, history of measles two weeks prior.',
    'Référence urgente à l''hôpital de Zinder. Noma stade 3 confirmé.',
    '22222222-0000-0000-0000-000000000001',
    13.77, 9.03, 'zinder', 36, now() - interval '1 day'
  )
on conflict (id) do nothing;
