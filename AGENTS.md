# Instruções para agentes de IA — Cirurgias_CPAM

Este arquivo contém regras obrigatórias para qualquer agente de IA ou pessoa que faça alterações neste repositório. Leia-o antes de analisar, editar ou publicar código.

## 1. Princípio central

**Primeiro preservar, depois melhorar.**

O sistema é utilizado em um contexto hospitalar e contém dados e fluxos operacionais importantes. Uma alteração só é boa se resolver o pedido sem comprometer o que já funciona.

- Faça somente o que foi solicitado.
- Não aproveite uma tarefa para refatorar, reorganizar ou redesenhar outras áreas.
- Não substitua arquivos inteiros quando uma alteração pequena e localizada for suficiente.
- Não remova funcionalidades, campos, validações, histórico ou dados sem autorização expressa.
- Se houver dúvida sobre uma regra de negócio, pare e pergunte em vez de presumir.

## 2. Antes de alterar o projeto

1. Consulte este arquivo e o contexto da funcionalidade solicitada.
2. Confira a versão atual do arquivo e o estado da branch antes de editar.
3. Identifique os arquivos, funções, componentes e integrações que realmente serão afetados.
4. Entenda as dependências e os fluxos relacionados antes de modificar qualquer trecho.
5. Informe ao solicitante o que pretende alterar, os riscos relevantes e como a mudança será verificada, especialmente quando houver risco para dados, autenticação ou funcionamento geral.

Não trabalhe sobre uma cópia antiga do código nem presuma que o conteúdo de uma conversa anterior ainda corresponde à versão atual do repositório.

## 3. Regras de layout e identidade visual

A interface deve manter a identidade visual já adotada pelo Cirurgias_CPAM.

- Preserve cores, tipografia, espaçamentos, ícones, bordas, sombras, componentes e padrões de navegação existentes, salvo quando o solicitante pedir uma mudança.
- Não crie uma identidade visual paralela para uma tela isolada.
- Preserve a hierarquia visual e a linguagem dos componentes já existentes.
- Botões, campos, tabelas, cards, modais, menus e cabeçalhos devem manter consistência com o restante do sistema.
- Toda alteração visual deve ser responsiva e considerar telas grandes, tablets e celulares.
- Não altere o comportamento de componentes compartilhados para resolver um problema local sem avaliar o impacto nas demais telas.
- Evite CSS global quando uma classe ou regra limitada ao componente/tela resolver o problema.
- Não duplique estilos nem crie regras conflitantes. Verifique os estilos existentes antes de acrescentar novos.
- Em grades responsivas, respeite a quantidade de colunas e os pontos de quebra pedidos pelo solicitante; não altere a estrutura funcional dos cards.
- Preserve acessibilidade básica: rótulos claros, foco visível, controles utilizáveis por teclado e contraste adequado.

## 4. Regras para documentos e impressão

Estas regras se aplicam a todo relatório, ficha, comprovante, agendamento, formulário ou documento gerado pelo sistema para impressão ou exportação em formato de página.

### 4.1 Formato de página

- **A4 é o formato padrão obrigatório** para documentos impressos.
- Configure o formato por CSS de impressão, preferencialmente com `@page { size: A4; }`.
- Respeite margens adequadas e a área imprimível.
- Evite cortes, sobreposições, conteúdo fora da página, páginas em branco e quebras em locais inadequados.
- Se um documento precisar excepcionalmente de outro formato ou orientação, isso deve ser solicitado ou aprovado pelo responsável pelo sistema.

### 4.2 Cabeçalho institucional obrigatório

Todo documento deve utilizar o mesmo padrão institucional no topo da primeira página e, quando o documento tiver mais páginas, repetir o cabeçalho ou ao menos a identificação institucional conforme a necessidade de leitura e as limitações técnicas da impressão.

A composição obrigatória é:

- **Canto superior esquerdo:** imagem institucional CPAM, usando o arquivo existente `logo-cpam.png`.
- **Área central:** identificação:
  - `COMPLEXO PEDIÁTRICO ARLINDA MARQUES`
  - `CPAM · BLOCO CIRÚRGICO`
- **Canto superior direito:** imagem `SESPB.png`, já existente no repositório.
- **Abaixo da linha divisória:** título do documento e subtítulo descritivo específico.

Referências dos arquivos (usar os caminhos reais e compatíveis com a forma como o sistema serve os arquivos):
- `logo-cpam.png`
- `SESPB.png`

Requisitos visuais:
- Use tipografia equivalente a `Inter`, `Segoe UI` ou `Arial`, conforme os recursos já disponíveis.
- Preserve integralmente a proporção das duas imagens; use `object-fit: contain` e dimensões proporcionais.
- Não estique, deforme, recorte, redesenhe ou substitua as marcas por imagens aproximadas.
- Mantenha a identificação institucional centralizada e visualmente equilibrada entre as duas marcas.
- Use a linha divisória discreta, o título em destaque e o subtítulo em hierarquia inferior, conforme o padrão aprovado.
- O título e o subtítulo variam conforme o documento; a identificação institucional e a posição das marcas não variam.
- Não use um cabeçalho improvisado ou diferente em cada módulo.

### 4.3 Estrutura de referência do cabeçalho

Use esta estrutura como referência conceitual e adapte apenas classes, dimensões e caminhos de imagem à implementação existente, sem alterar a identidade definida:

```html
<header class="print-document-header">
  <div class="print-institution-row">
    <img src="logo-cpam.png" alt="Logo CPAM"
         class="print-logo print-logo-cpam" />
    <div class="print-institution-name">
      <div>COMPLEXO PEDIÁTRICO ARLINDA MARQUES</div>
      <div>CPAM · BLOCO CIRÚRGICO</div>
    </div>
    <img src="SESPB.png" alt="Logo Secretaria de Estado da Saúde da Paraíba"
         class="print-logo print-logo-sespb" />
  </div>
  <div class="print-document-title">
    <h1>{{TITULO_DO_DOCUMENTO}}</h1>
    <p>{{SUBTITULO_DESCRITIVO}}</p>
  </div>
</header>
```

O cabeçalho deve manter a distribuição esquerda-centro-direita: logo CPAM, identificação institucional e logo SESPB. Não substitua os arquivos oficiais por URLs externas ou imagens obtidas por busca.

### 4.4 Conteúdo e comportamento de impressão

- O conteúdo deve ser organizado para leitura em papel, não apenas para aparência na tela.
- Não imprimir menus, botões de ação, controles de navegação ou elementos exclusivos da interface.
- Mantenha datas, nomes, identificadores e informações clínicas/administrativas legíveis e sem truncamento.
- Não invente nem omita dados para preencher espaços.
- Não altere o significado ou a ordem dos dados do documento sem autorização.
- Antes de concluir, verifique visualização de impressão, orientação, margens, quebras de página, imagens e legibilidade.

## 5. Segurança e dados

- Nunca exponha chaves, tokens, senhas, cookies, segredos ou credenciais em código público, logs, documentação ou mensagens.
- Não coloque credenciais reais em arquivos do repositório.
- Não enfraqueça autenticação, autorização ou políticas de Row Level Security (RLS).
- Não altere tabelas, colunas, funções, triggers, políticas RLS, dados existentes ou migrations sem autorização explícita.
- Não execute operações destrutivas, importações, exclusões em massa ou redefinições de dados sem aprovação expressa e plano de reversão.
- Preserve o isolamento de dados por usuário/perfil e as permissões já implementadas.
- Trate dados de pacientes como informações sensíveis: use apenas o mínimo necessário e não os reproduza em exemplos, logs ou testes públicos.
- Não altere integrações com Supabase, VITAI ou outros serviços externos fora do escopo solicitado.
- Nunca grave automaticamente dados retornados por uma integração sem respeitar as confirmações e regras do fluxo existente.

## 6. Regras de negócio e integridade funcional

- Não presuma regras clínicas, administrativas ou de regulação.
- Preserve o histórico de pacientes e ocorrências cirúrgicas.
- Não confunda dados do paciente com dados específicos de cada cirurgia ou agendamento.
- Preserve validações, permissões por perfil, estados, cancelamentos, auditoria e rastreabilidade.
- Não altere quem pode criar, confirmar, remarcar, cancelar ou editar um agendamento sem autorização expressa.
- Antes de mudar consultas ou gravações no banco, entenda os relacionamentos e o impacto sobre registros existentes.
- Em caso de conflito entre uma melhoria visual e o fluxo operacional, preserve o fluxo operacional.

## 7. Cuidados especiais com arquivos e alterações de código

- Faça mudanças pequenas, isoladas e fáceis de revisar.
- Em arquivos grandes, especialmente no `index.html`, nunca faça substituições textuais amplas ou baseadas em trechos genéricos.
- Localize uma âncora única, confira o contexto antes e depois da alteração e confirme que o trecho correto foi modificado.
- Tenha cuidado especial com strings de HTML, templates de impressão, crases, aspas, chaves, tags `<script>` e blocos de CSS/JavaScript.
- Não insira CSS dentro de strings HTML/JavaScript ou templates de impressão por engano.
- Preserve a estrutura e a ordem de carregamento dos scripts.
- Não introduza frameworks, bibliotecas, dependências ou ferramentas de build sem necessidade e autorização.
- Não presuma que o projeto usa npm, Vite ou outro processo de build: confira os arquivos e a configuração atuais antes de escolher como testar.
- Não altere arquivos de configuração de deploy ou rotas sem necessidade comprovada.

## 8. Testes e critérios para considerar uma alteração concluída

Um commit realizado com sucesso não comprova que o sistema está funcionando.

Antes de considerar uma alteração concluída:
1. Revise o diff e confirme que somente os arquivos esperados foram alterados.
2. Verifique sintaxe e estrutura dos trechos modificados.
3. Confira se o sistema abre e inicializa sem erros fatais.
4. Verifique o fluxo principal afetado e ao menos os caminhos adjacentes com risco de regressão.
5. Para mudanças de layout, confira telas grandes e pequenas.
6. Para documentos, confira a pré-visualização e a impressão em A4, incluindo cabeçalho, imagens e quebras de página.
7. Para mudanças de banco ou integração, verifique os fluxos de leitura e gravação autorizados sem expor dados sensíveis.
8. Confira o resultado do deploy quando houver publicação.

Se não houver ambiente ou ferramenta para executar um teste, informe claramente o que foi e o que não foi verificado. Nunca diga que testou algo que não executou.

**Não publique em produção uma alteração de alto risco sem validação suficiente e sem comunicar a limitação ao responsável.** Se a validação não for possível, explique o risco e solicite orientação antes de prosseguir.

## 9. Commits, publicação e recuperação

- Use mensagens de commit claras e relacionadas ao escopo real.
- Não misture correções independentes no mesmo commit sem necessidade.
- Confira a branch e o commit de destino antes de publicar.
- Após o commit, confira o estado do deploy e diferencie commit aceito, build concluído e aplicação efetivamente validada.
- Não declare que a publicação está funcionando apenas porque o GitHub recebeu o commit.
- Se uma alteração causar falha, priorize restaurar a última versão comprovadamente funcional antes de tentar novas melhorias.
- Ao reverter, preserve alterações válidas de outras funcionalidades e explique exatamente o que foi restaurado.

## 10. Comunicação com o responsável pelo sistema

Ao apresentar uma alteração, informe de forma objetiva:
- O que foi alterado.
- Quais arquivos foram modificados.
- O que permaneceu intocado.
- Quais testes foram executados e seus resultados.
- O que não foi possível testar.
- O commit e o estado do deploy, quando aplicável.

Não esconda erros, limitações ou incertezas. Se o pedido puder afetar dados, segurança, autenticação, impressão institucional ou disponibilidade do sistema, esclareça o risco antes de agir.

---

## Regra de ouro

**Preservar o que funciona, alterar somente o necessário e validar antes de publicar.**
