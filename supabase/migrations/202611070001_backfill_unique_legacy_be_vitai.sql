-- Preenche BE VITAI apenas quando o histórico legado aponta um único valor por paciente.
-- Pacientes com mais de um NBE distinto permanecem sem alteração para revisão manual.
with nbe_unico as (
  select paciente_id, min(trim("NBE")) as numero_be_vitai
  from public.cirurgias
  where paciente_id is not null
    and nullif(trim("NBE"), '') is not null
  group by paciente_id
  having count(distinct trim("NBE")) = 1
)
update public.pacientes p
set numero_be_vitai = n.numero_be_vitai
from nbe_unico n
where p.id = n.paciente_id
  and nullif(trim(p.numero_be_vitai), '') is null;
