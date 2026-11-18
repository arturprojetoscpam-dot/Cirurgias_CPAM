-- Sessões VITAI mantidas no servidor para permitir chamadas diretas pela Edge Function.
-- Os cookies são criptografados com a mesma chave AES-GCM usada em vitai_credentials.
create table if not exists public.vitai_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nonce text not null,
  encrypted_payload text not null,
  expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vitai_sessions enable row level security;
revoke all on table public.vitai_sessions from anon, authenticated;
grant all on table public.vitai_sessions to service_role;

comment on table public.vitai_sessions is
  'Cookies de sessão VITAI criptografados por usuário, acessíveis somente pela Edge Function.';
