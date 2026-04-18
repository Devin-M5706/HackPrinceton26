-- NomaAlert seed data — demo / judge scenario
-- 3 cases: 2 near threshold in Zinder region, 1 that triggers the cluster alert

-- ── CHWs ─────────────────────────────────────────────────────────────────────

insert into chws (id, name, region, language, auth_token) values
  ('11111111-0000-0000-0000-000000000001', 'Amina Musa',      'zinder',    'hausa',   'chw-token-amina'),
  ('11111111-0000-0000-0000-000000000002', 'Jean-Pierre Koné','maradi',    'french',  'chw-token-jean'),
  ('11111111-0000-0000-0000-000000000003', 'Grace Okafor',    'supervisor','english', 'chw-token-supervisor')
on conflict (id) do nothing;

-- ── Clinics ───────────────────────────────────────────────────────────────────

insert into clinics (id, name, region, lat, lng, noma_capable, contact) values
  ('22222222-0000-0000-0000-000000000001', 'Zinder National Hospital',         'zinder',  13.8069, 8.9881,  true,  '+227 20 51 23 45'),
  ('22222222-0000-0000-0000-000000000002', 'Maradi Regional Medical Centre',   'maradi',  13.5006, 7.0977,  true,  '+227 20 41 12 33'),
  ('22222222-0000-0000-0000-000000000003', 'Niamey National Hospital',         'niamey',  13.5137, 2.1098,  true,  '+227 20 72 25 21'),
  ('22222222-0000-0000-0000-000000000004', 'Agadez District Health Centre',    'agadez',  16.9742, 7.9989,  false, '+227 20 44 00 44')
on conflict (id) do nothing;

-- ── Cases — 3 staged around Zinder to trigger cluster on next VM 4 poll ──────
-- All within ~8 km of each other so the 10 km haversine bucket catches them

insert into cases (id, chw_id, stage, risk_score, triage, clinical_note, referral_note, clinic_id, lat, lng, child_age_months, created_at) values
  (
    '33333333-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    3, 74, 'urgent',
    'Stage 3 Noma with active necrosis on left cheek. Child is 28 months, severely malnourished.',
    'An Aika yaro zuwa asibitin Zinder nan da nan. Yana bukata maganin rigakafi da kulawa na musamman.',
    '22222222-0000-0000-0000-000000000001',
    13.82, 9.01,
    28,
    now() - interval '3 days'
  ),
  (
    '33333333-0000-0000-0000-000000000002',
    '11111111-0000-0000-0000-000000000001',
    2, 55, 'refer',
    'Stage 2 Noma with perioral oedema and early tissue involvement. Child is 19 months.',
    'Refer to Zinder Hospital for antibiotic treatment and nutritional support.',
    '22222222-0000-0000-0000-000000000001',
    13.79, 8.98,
    19,
    now() - interval '5 days'
  ),
  (
    '33333333-0000-0000-0000-000000000003',
    '11111111-0000-0000-0000-000000000002',
    3, 80, 'urgent',
    'Stage 3 Noma. Extensive cheek necrosis. Child 36 months, history of measles 2 weeks prior.',
    'Référence urgente à l''hôpital de Zinder. Noma stade 3 confirmé.',
    '22222222-0000-0000-0000-000000000001',
    13.77, 9.03,
    36,
    now() - interval '1 day'
  )
on conflict (id) do nothing;

-- The 3 cases above are all within ~8km of each other around Zinder (13.79°N, 9.00°E).
-- VM 4's next poll will detect this cluster and fire an alert + SMS.
-- You can force an immediate demo alert by calling the surveillance poll manually.
