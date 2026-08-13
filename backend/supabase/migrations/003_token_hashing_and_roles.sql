-- lumos.health — hashed bearer tokens and explicit roles
--
-- Two changes:
--
--   1. `chws.auth_token` stored bearer tokens in plaintext, so anyone who could
--      read the table held every CHW's live credential. Tokens are now stored
--      as a SHA-256 digest and the plaintext column is dropped.
--
--   2. Authorisation was decided with `chw.region.includes('supervisor')`,
--      which overloaded a free-text geography field as a permission bit and
--      made the literal region string "supervisor" a privilege escalation. A
--      dedicated `role` column replaces it.

begin;

-- ── 1. Roles ─────────────────────────────────────────────────────────────────

alter table chws
  add column if not exists role text not null default 'chw';

-- Anyone whose region was being used as the supervisor flag keeps their access.
update chws
   set role = 'supervisor',
       region = 'unknown'
 where region ilike '%supervisor%';

alter table chws
  drop constraint if exists chws_role_check;

alter table chws
  add constraint chws_role_check check (role in ('chw', 'supervisor'));

-- ── 2. Token hashing ─────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

alter table chws
  add column if not exists auth_token_hash text;

-- Backfill digests for existing tokens so current sessions keep working.
update chws
   set auth_token_hash = encode(digest(auth_token, 'sha256'), 'hex')
 where auth_token_hash is null
   and auth_token is not null;

-- Any row still without a digest cannot authenticate; give it an unguessable
-- placeholder so the NOT NULL constraint can be applied. Those CHWs re-enrol
-- through phone sign-in, which issues a fresh token.
update chws
   set auth_token_hash = encode(digest(gen_random_uuid()::text, 'sha256'), 'hex')
 where auth_token_hash is null;

alter table chws
  alter column auth_token_hash set not null;

create unique index if not exists chws_auth_token_hash_key
  on chws (auth_token_hash);

alter table chws
  drop column if exists auth_token;

-- ── 3. Supporting indexes ────────────────────────────────────────────────────

create index if not exists chws_phone_idx on chws (phone);

-- The public map endpoint and the surveillance agent both filter recent,
-- geolocated cases by stage.
create index if not exists cases_created_at_stage_idx
  on cases (created_at desc, stage);

commit;
