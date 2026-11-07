-- Aditiva e compatível com registros legados.
begin;
alter table public.pacientes
  add column if not exists cpf text,
  add column if not exists numero_be_vitai text;
comment on column public.pacientes.cpf is 'CPF do paciente; texto para preservar zeros à esquerda.';
comment on column public.pacientes.numero_be_vitai is 'Número de identificação BE VITAI do paciente.';
alter table public.cirurgias
  add column if not exists horario_inicio time,
  add column if not exists horario_fim time,
  add column if not exists sala_cirurgica text,
  add column if not exists codigo_tuss_sus text,
  add column if not exists medico_auxiliar text,
  add column if not exists instrumentador_enfermagem text,
  add column if not exists biopsia_encaminhada boolean,
  add column if not exists encaminhado_uti boolean,
  add column if not exists necessitou_hemoderivados boolean,
  add column if not exists descricao_cirurgica text;
comment on column public.cirurgias.horario_inicio is 'Horário de início do procedimento cirúrgico.';
comment on column public.cirurgias.horario_fim is 'Horário de término do procedimento cirúrgico.';
comment on column public.cirurgias.sala_cirurgica is 'Sala cirúrgica ou bloco onde o procedimento foi realizado.';
comment on column public.cirurgias.codigo_tuss_sus is 'Código TUSS ou SUS do procedimento.';
comment on column public.cirurgias.medico_auxiliar is 'Médico auxiliar da equipe cirúrgica.';
comment on column public.cirurgias.instrumentador_enfermagem is 'Instrumentador ou profissional de enfermagem responsável.';
comment on column public.cirurgias.biopsia_encaminhada is 'Indica encaminhamento de biópsia/anatomopatológico.';
comment on column public.cirurgias.encaminhado_uti is 'Indica encaminhamento do paciente para UTI.';
comment on column public.cirurgias.necessitou_hemoderivados is 'Indica necessidade de hemoderivados/sangue.';
comment on column public.cirurgias.descricao_cirurgica is 'Descrição, observações e intercorrências cirúrgicas.';
create index if not exists idx_pacientes_cpf on public.pacientes (cpf) where cpf is not null and cpf <> '';
create index if not exists idx_pacientes_be_vitai on public.pacientes (numero_be_vitai) where numero_be_vitai is not null and numero_be_vitai <> '';
create index if not exists idx_cirurgias_paciente_data on public.cirurgias (paciente_id, "Data_da_Cirurgia" desc);
commit;
