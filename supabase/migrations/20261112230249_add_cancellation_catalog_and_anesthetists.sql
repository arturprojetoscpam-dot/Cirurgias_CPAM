create table public.cancelamentos (
  id_cancelamento integer primary key,
  motivo text not null,
  tipo text not null check (tipo in ('PACIENTE','EXTRA-PACIENTE','AMBOS')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cancelamentos_motivo_nao_vazio check (btrim(motivo) <> '')
);
comment on table public.cancelamentos is 'Catálogo padronizado de motivos de cancelamento cirúrgico.';
alter table public.cancelamentos enable row level security;
grant select, insert, update on public.cancelamentos to authenticated;
create policy cancelamentos_authenticated_select on public.cancelamentos
for select to authenticated using (true);
create policy cancelamentos_operacionais_insert on public.cancelamentos
for insert to authenticated
with check ((select private.has_any_role(array['administrador','coordenacao','cadastro']::text[])));
create policy cancelamentos_operacionais_update on public.cancelamentos
for update to authenticated
using ((select private.has_any_role(array['administrador','coordenacao','cadastro']::text[])))
with check ((select private.has_any_role(array['administrador','coordenacao','cadastro']::text[])));
alter table public.cirurgias add column id_cancelamento integer references public.cancelamentos(id_cancelamento) on delete set null;
create index cirurgias_id_cancelamento_idx on public.cirurgias(id_cancelamento);

insert into public.cancelamentos (id_cancelamento,motivo,tipo) values
(1,'Instabilidade Clinica do Paciente','PACIENTE'),
(2,'Falta de preparo do paciente / Jejum Inadequado','PACIENTE'),
(3,'Nao comparecimento do paciente','PACIENTE'),
(4,'Transferencia do paciente','PACIENTE'),
(5,'Alta a pedido','PACIENTE'),
(6,'Falta de documentação/exames','PACIENTE'),
(7,'Falha na solicitaçao','EXTRA-PACIENTE'),
(8,'Mudança de conduta medica','EXTRA-PACIENTE'),
(9,'Falta de material/OPME','EXTRA-PACIENTE'),
(10,'Falta de equipamento','EXTRA-PACIENTE'),
(11,'Falta de enxoval','EXTRA-PACIENTE'),
(12,'Falta de leito de UTI pos-operatorio','EXTRA-PACIENTE'),
(13,'Falta de sala cirurgica','EXTRA-PACIENTE'),
(14,'Ausencia do medico','EXTRA-PACIENTE'),
(15,'Ausencia de anestesista','EXTRA-PACIENTE'),
(16,'Outro','AMBOS'),
(17,'Falta de Leito de Internaçao (Clinica Cirurgica)','EXTRA-PACIENTE'),
(18,'Falta de Medicaçoes ou Insumos','EXTRA-PACIENTE');

insert into public.profissionais (crm,nome,grupo,ativo,origem)
select v.crm,v.nome,'Anestesista',true,'TB_ANESTESISTA'
from (values
('9190','ANA LUISA S. BOULITREAU'),('2673','AZUILA BRAGA LACERDA'),
('10297','CLOVIS AMARANTE'),('7163','EDMILSON G. O. FILHO'),
('6942','HERMANO NOBREGA'),('6847','JANAINA JAPIASSU'),
('6566','JOSE CLEIBER'),('5341','LIGIA FERREIRA DOS SANTOS'),
('6782','MARIA DE LOURDES MACEDO'),('8670','NATALIA DE CASTRO GOMES'),
('7813','ROSSANA SÁ DIAS'),('5026','SANDRA M. LIRA MENDES DE CARVALHO'),
('7345','SERGIO H. DA POIAN'),('7043','THAYSA LANNE A DOS SANTOS'),
('6660','VIRGINIA LEMOS'),('5466','WALTER MENDES'),
('8442','SERGIO MURILO G CARVALHO'),('6385','FERNANDO MUNIZ LOPES'),
('6591','HUMBERTO ARCOVERDE VIANA COÊLHO'),('13472','ARLLEY ARAUJO DEDIER BARBOSA'),
('10393','DANIEL IDELFONSO DANTAS'),('1111','NÃO INFORMADO')
) as v(crm,nome)
where not exists (select 1 from public.profissionais p where p.grupo='Anestesista' and p.crm=v.crm);
update public.profissionais p
set nome=v.nome, ativo=true, origem='TB_ANESTESISTA', updated_at=now()
from (values
('9190','ANA LUISA S. BOULITREAU'),('2673','AZUILA BRAGA LACERDA'),
('10297','CLOVIS AMARANTE'),('7163','EDMILSON G. O. FILHO'),
('6942','HERMANO NOBREGA'),('6847','JANAINA JAPIASSU'),
('6566','JOSE CLEIBER'),('5341','LIGIA FERREIRA DOS SANTOS'),
('6782','MARIA DE LOURDES MACEDO'),('8670','NATALIA DE CASTRO GOMES'),
('7813','ROSSANA SÁ DIAS'),('5026','SANDRA M. LIRA MENDES DE CARVALHO'),
('7345','SERGIO H. DA POIAN'),('7043','THAYSA LANNE A DOS SANTOS'),
('6660','VIRGINIA LEMOS'),('5466','WALTER MENDES'),
('8442','SERGIO MURILO G CARVALHO'),('6385','FERNANDO MUNIZ LOPES'),
('6591','HUMBERTO ARCOVERDE VIANA COÊLHO'),('13472','ARLLEY ARAUJO DEDIER BARBOSA'),
('10393','DANIEL IDELFONSO DANTAS'),('1111','NÃO INFORMADO')
) as v(crm,nome)
where p.grupo='Anestesista' and p.crm=v.crm;
