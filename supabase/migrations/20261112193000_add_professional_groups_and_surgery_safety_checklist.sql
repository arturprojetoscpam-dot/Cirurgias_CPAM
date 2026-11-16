alter table public.profissionais
  add column grupo text not null default 'Cirurgiao',
  alter column id_origem drop not null,
  alter column crm drop not null;

alter table public.profissionais
  add constraint profissionais_grupo_check
  check (grupo in ('Cirurgiao', 'Anestesista', 'Instrumentador'));

update public.profissionais
set grupo = 'Cirurgiao'
where grupo is null or btrim(grupo) = '';

comment on column public.profissionais.grupo is
  'Grupo funcional do profissional no bloco cirúrgico: Cirurgiao, Anestesista ou Instrumentador.';
comment on column public.profissionais.crm is
  'Registro profissional/CRM quando aplicável; pode ficar vazio para instrumentadores.';

create index profissionais_grupo_ativo_nome_idx
  on public.profissionais (grupo, ativo, nome);

alter table public.cirurgias
  add column anestesista_profissional_id uuid references public.profissionais(id) on delete set null,
  add column instrumentador_profissional_id uuid references public.profissionais(id) on delete set null,
  add column checklist_cirurgia_segura boolean;

create index cirurgias_anestesista_profissional_id_idx
  on public.cirurgias (anestesista_profissional_id);
create index cirurgias_instrumentador_profissional_id_idx
  on public.cirurgias (instrumentador_profissional_id);

comment on column public.cirurgias.checklist_cirurgia_segura is
  'Indica se o bloco realizou o checklist de cirurgia segura; NULL significa não informado.';
