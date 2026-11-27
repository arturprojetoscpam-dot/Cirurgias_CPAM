# Registro de Cirurgias CPAM

Sistema de registro e acompanhamento das atividades do Bloco Cirúrgico do Complexo Pediátrico Arlinda Marques.

## Documentação e regras do projeto

- **[AGENTS.md](./AGENTS.md)** — regras obrigatórias para alterações no sistema, preservação do layout, segurança, integridade dos dados, documentos impressos, testes e publicação.
- Este README mantém informações de referência sobre integrações e implantação. As regras de desenvolvimento devem ser consultadas no AGENTS.md antes de qualquer alteração.

## Padrão institucional dos documentos

Todos os relatórios, fichas, comprovantes, agendamentos e demais documentos destinados à impressão devem seguir o padrão definido em [AGENTS.md](./AGENTS.md):

- Formato A4 como padrão.
- Logo CPAM no canto superior esquerdo (`logo-cpam.png`).
- Identificação institucional centralizada: **COMPLEXO PEDIÁTRICO ARLINDA MARQUES** e **CPAM · BLOCO CIRÚRGICO**.
- Logo SESPB no canto superior direito (`SESPB.png`).
- Título e subtítulo abaixo da linha divisória.
- Proporções originais das imagens preservadas, sem cortes ou deformações.

## Integração direta com o VITAI

A busca por BE é realizada pelo navegador diretamente na Edge Function `vitai-direct` do Supabase, que autentica o usuário CPAM, recupera as credenciais VITAI criptografadas e consulta o VITAI por HTTP.

Fluxo atual:

`Navegador → Supabase Edge Function (vitai-direct) → VITAI`

- A Edge Function valida o JWT do usuário CPAM e confere se o perfil está ativo.
- As credenciais VITAI permanecem criptografadas em `vitai_credentials`.
- Os cookies de sessão VITAI são criptografados em `vitai_sessions`, com expiração por inatividade de 15 minutos.
- As três consultas VITAI continuam paralelas: `paciente.do`, `boletimEmergencia.do` e `evolucaoPacienteInterno.do`.
- A busca retorna os dados ao formulário para conferência; não grava automaticamente dados do paciente ou cirurgia.
- A função antiga `vitai-relay` e o agente local permanecem disponíveis temporariamente para permitir reversão enquanto a nova integração é validada.

### Implantação

A função `vitai-direct` está implantada no projeto Supabase `banco_cirurgias`. A migration `20261118110000_create_vitai_sessions.sql` cria o armazenamento privado das sessões criptografadas.

Secrets necessários na Edge Function:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (ou `SUPABASE_PUBLISHABLE_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SECRET_KEY`)
- `VITAI_ENCRYPTION_KEY` (32 bytes em hexadecimal)
- `VITAI_BASE_URL` (opcional; padrão `https://hiam.vitai.care`)
