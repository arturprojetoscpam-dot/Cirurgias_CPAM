# Integração local CPAM ↔ TIMED

## Estado desta etapa

- Na opção **Novo Paciente**, o usuário informa o número da BE VITAI, conecta-se ao TIMED e solicita a busca.
- Os dados encontrados preenchem os campos do formulário de cadastro do paciente, para revisão e correção antes de salvar.
- O serviço local é somente leitura no TIMED.
- Os dados retornados são apresentados para conferência.
- Ao confirmar, os campos são preenchidos no formulário existente do paciente. A gravação no CPAM só acontece quando o usuário clica em **Salvar Cadastro**. O campo BE usado na busca não é gravado como prontuário do paciente.
- A cirurgia continua dependendo do clique separado em **Salvar Cirurgia**.
- Não há escrita no TIMED nem gravação automática no Supabase.

## Serviço local no Windows

O serviço deve continuar sendo executado somente em `127.0.0.1:4173`.

1. Faça uma cópia de segurança de `C:\timed-integracao\server.js`.
2. Copie este arquivo `server.js` para `C:\timed-integracao\server.js`, substituindo a versão anterior.
3. Não altere nem copie credenciais para arquivos.
4. Reinicie o serviço local. Se estiver usando a tarefa agendada, encerre o processo Node anterior antes de iniciar novamente.
5. Confirme que o terminal/log informa `http://127.0.0.1:4173`.

As dependências existentes do projeto local (Express e Playwright) são reutilizadas. Não é necessário executar uma nova instalação se elas já estão instaladas em `C:\timed-integracao\node_modules`.

## Origem autorizada

Por segurança, a API aceita:

- Produção: `https://cirurgiascpam.vercel.app`
- Previews HTTPS cujo host siga o padrão `cirurgiascpam-<identificador>-arturprojetoscpam-dot.vercel.app`
- Host local: `127.0.0.1:4173`

A validação não libera `*.vercel.app`: exige o prefixo do projeto, o sufixo do escopo Vercel desta conta e HTTPS. Endereços de outros projetos ou de outros escopos continuam bloqueados. O serviço local permanece vinculado exclusivamente a `127.0.0.1`.

## Segurança

- O processo escuta apenas em loopback (`127.0.0.1`), não na rede local.
- A API valida o cabeçalho `Origin` e o cabeçalho `Host`.
- O token de sessão é aleatório, temporário e mantido apenas em memória.
- O token é exigido para consultar e encerrar a sessão.
- Usuário e senha do TIMED permanecem apenas na memória do processo e são apagados ao encerrar a sessão.
- Não grave credenciais, tokens ou dados de pacientes em arquivos de log, localStorage, sessionStorage ou no repositório.

## Navegador

A aplicação CPAM precisa estar aberta em HTTPS. Chrome/Edge recentes podem solicitar permissão para o site acessar o serviço de loopback do próprio computador. Autorize somente se estiver na página oficial do CPAM e entender que a conexão é com o serviço local TIMED.

## Limite do teste

Os commits desta branch não alteram a branch principal nem publicam a aplicação oficial. A integração ainda precisa ser testada na URL de preview exata desta branch antes de qualquer liberação para uso. Se a URL de preview for diferente do domínio oficial, ela deverá ser adicionada individualmente à allowlist do serviço local, nunca por curinga.
