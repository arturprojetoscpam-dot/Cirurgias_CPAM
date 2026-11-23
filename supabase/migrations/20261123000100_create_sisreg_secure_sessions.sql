-- Credenciais e cookies SISREG criptografados por usuário.
create table if not exists public.sisreg_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nonce text not null,
  encrypted_payload text not null,
  updated_at timestamptz not null default now(),
  last_validated_at timestamptz,
  last_validation_ok boolean not null default false
);
alter table public.sisreg_credentials enable row level security;
revoke all on table public.sisreg_credentials from anon, authenticated;
grant all on table public.sisreg_credentials to service_role;
comment on table public.sisreg_credentials is
  'Credenciais SISREG criptografadas individualmente por usuário; somente a Edge Function acessa os dados.';

create table if not exists public.sisreg_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nonce text not null,
  encrypted_payload text not null,
  expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sisreg_sessions enable row level security;
revoke all on table public.sisreg_sessions from anon, authenticated;
grant all on table public.sisreg_sessions to service_role;
comment on table public.sisreg_sessions is
  'Cookies de sessão SISREG criptografados por usuário, acessíveis somente pela Edge Function.';
