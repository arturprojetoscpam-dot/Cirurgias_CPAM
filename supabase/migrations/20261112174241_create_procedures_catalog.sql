create table public.procedimentos (
  cod_proced text primary key,
  codigo_origem integer not null unique,
  inicio text not null,
  procedimento text not null,
  sistema text,
  especialidade text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procedimentos_cod_proced_not_blank check (btrim(cod_proced) <> ''),
  constraint procedimentos_procedimento_not_blank check (btrim(procedimento) <> '')
);

comment on table public.procedimentos is 'Catálogo de procedimentos importado de Tb_Procedimentos_BC.xml.';
comment on column public.procedimentos.cod_proced is 'Código TUSS/SUS de origem, armazenado como texto para preservar zeros à esquerda.';
comment on column public.procedimentos.codigo_origem is 'Identificador sequencial da coluna Código do XML de origem.';
comment on column public.procedimentos.inicio is 'Valor original da coluna INICIO do XML.';
comment on column public.procedimentos.sistema is 'Sistema corporal conforme XML de origem.';
comment on column public.procedimentos.especialidade is 'Especialidade conforme XML de origem.';

create index procedimentos_nome_trgm_idx
  on public.procedimentos using gin (procedimento extensions.gin_trgm_ops);
create index procedimentos_codigo_trgm_idx
  on public.procedimentos using gin (cod_proced extensions.gin_trgm_ops);

alter table public.cirurgias
  add column procedimento_catalogo_codigo text;

alter table public.cirurgias
  add constraint cirurgias_procedimento_catalogo_codigo_fkey
  foreign key (procedimento_catalogo_codigo)
  references public.procedimentos(cod_proced)
  on update cascade on delete set null;

create index cirurgias_procedimento_catalogo_codigo_idx
  on public.cirurgias (procedimento_catalogo_codigo);

alter table public.procedimentos enable row level security;
revoke all on table public.procedimentos from anon, authenticated;
grant select on table public.procedimentos to authenticated;
grant all on table public.procedimentos to service_role;

create policy procedimentos_authenticated_read
  on public.procedimentos
  for select
  to authenticated
  using (true);
