-- Web2APK: new tables + Row Level Security on ALL tables.
-- Run once in the Supabase SQL editor (safe to re-run).
-- The server uses the service-role key (bypasses RLS); the browser only uses the anon key
-- for Supabase Auth, so locking every table down does not break the app.

-- ── New tables (already created in this project; kept here so the schema is reproducible) ──
create table if not exists public.api_keys (
  id serial primary key,
  user_id text not null,
  name text not null,
  prefix text not null,
  key_hash text not null,
  webhook_secret_enc text,
  rate_per_hour integer default 10,
  monthly_quota integer default 200,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);
create unique index if not exists api_keys_key_hash_idx on public.api_keys (key_hash);
create index if not exists api_keys_user_idx on public.api_keys (user_id);

create table if not exists public.telegram_bots (
  id serial primary key,
  user_id text not null,
  bot_id bigint not null,
  bot_username text,
  token_enc text not null,
  hook_id text not null,
  secret_hash text not null,
  link_code text,
  owner_chat_id bigint,
  allow_public boolean default false,
  enabled boolean default true,
  disabled_by_admin boolean default false,
  webhook_ok boolean default false,
  last_update_at timestamptz,
  created_at timestamptz default now()
);
create unique index if not exists telegram_bots_hook_idx on public.telegram_bots (hook_id);
create unique index if not exists telegram_bots_bot_idx on public.telegram_bots (bot_id);

create table if not exists public.build_meta (
  build_id integer primary key references public.builds(id) on delete cascade,
  user_id text not null,
  source text not null check (source in ('web','telegram','api','zip')),
  site_url text,
  app_name text,
  package_name text,
  api_key_id integer,
  telegram_bot_id integer,
  telegram_chat_id bigint,
  webhook_url text,
  webhook_status text,
  notified_status text,
  last_callback_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists build_meta_key_time_idx on public.build_meta (api_key_id, created_at);
create index if not exists build_meta_chat_time_idx on public.build_meta (telegram_bot_id, telegram_chat_id, created_at);
create index if not exists build_meta_user_time_idx on public.build_meta (user_id, source, created_at);

create table if not exists public.admin_sessions (
  id text primary key,
  admin_email text not null,
  refresh_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz default now()
);

create table if not exists public.admin_audit (
  id serial primary key,
  admin_email text,
  action text not null,
  target text,
  details jsonb,
  ip text,
  created_at timestamptz default now()
);

-- Unused (settings live in the private vault) but created earlier; locked below.
create table if not exists public.system_settings (key text primary key, value jsonb, updated_at timestamptz default now());

-- ── Enable RLS everywhere. No anon/authenticated policies are needed: all data access goes
--    through the API server with the service-role key. ──
do $$
declare t text;
begin
  foreach t in array array['projects','builds','toolchains','agents','github_connections','cloud_runs',
                           'api_keys','telegram_bots','build_meta','admin_sessions','admin_audit','system_settings']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Audit log is append-only even for the service role.
create or replace function public.admin_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'admin_audit is append-only'; end $$;
drop trigger if exists admin_audit_no_update on public.admin_audit;
create trigger admin_audit_no_update before update or delete on public.admin_audit
  for each row execute function public.admin_audit_immutable();

-- ── Storage limits ──
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['application/zip','application/x-zip-compressed','application/octet-stream']
  where id = 'project-zips';
update storage.buckets set file_size_limit = 209715200, allowed_mime_types = array['application/vnd.android.package-archive','application/octet-stream']
  where id = 'apks';
update storage.buckets set public = false where id = 'secrets';

-- Optional hardening (breaks old public links in the dashboard): make sources private.
-- update storage.buckets set public = false where id = 'project-zips';
