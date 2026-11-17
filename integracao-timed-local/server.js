const express = require('express');
const crypto = require('crypto');
const { chromium } = require('playwright');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// A API só aceita chamadas originadas do domínio oficial do CPAM.
// O serviço permanece vinculado exclusivamente a 127.0.0.1.
const CPAM_ORIGIN = 'https://cirurgiascpam.vercel.app';
const LOCAL_HOST = '127.0.0.1:4173';
app.use('/api', (req, res, next) => {
  const origin = req.get('Origin');
  const host = req.get('Host');
  if (host !== LOCAL_HOST || origin !== CPAM_ORIGIN) {
    return res.status(403).json({ erro: 'Origem não autorizada para acessar a integração local.' });
  }
  res.setHeader('Access-Control-Allow-Origin', CPAM_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CPAM-Session');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static('public', { etag: false, maxAge: 0 }));

const TIMED_LOGIN = 'https://hiam.vitai.care/vitai/pages/login.do';
const TIMEOUT = 25000;
const MENU_SELECTORS = [
  'a[onclick*="paciente.do"]',
  'a[onclick*="3532"]',
  'a.list-group-item:has-text("PESQUISAR PACIENTE")'
];
const now = () => Number(process.hrtime.bigint()) / 1e9;
const seconds = start => Number((now() - start).toFixed(2));

// Sessão experimental única, mantida somente na memória deste processo.
const timed = { browser: null, context: null, pages: [], usuario: null, senha: null, ready: false, busy: false, sessionToken: null };

function requireSessionToken(req, res, next) {
  const supplied = req.get('X-CPAM-Session');
  if (!timed.sessionToken || !supplied || supplied !== timed.sessionToken) {
    return res.status(401).json({ erro: 'Sessão local não autorizada. Inicie novamente a conexão com o TIMED.' });
  }
  next();
}

async function allFrames() {
  timed.pages = timed.pages.filter(p => !p.isClosed());
  return timed.pages.flatMap(p => p.frames());
}
async function findVisible(selectors, timeout = TIMEOUT) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const frame of await allFrames()) {
      for (const selector of selectors) {
        try {
          const loc = frame.locator(selector).first();
          if (await loc.count() && await loc.isVisible()) return { frame, locator: loc, selector };
        } catch (_) {}
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Não encontrei o elemento esperado: ${selectors.join(' / ')}`);
}
async function visibleLogin() {
  try { return !!(await findVisible(['#login'], 900)); } catch (_) { return false; }
}
async function ensureBrowser() {
  if (timed.browser && timed.browser.isConnected()) return;
  timed.browser = await chromium.launch({ headless: true });
  timed.context = await timed.browser.newContext({ acceptDownloads: false });
  timed.pages = [];
  const page = await timed.context.newPage();
  timed.pages.push(page);
  timed.context.on('page', p => { if (!timed.pages.includes(p)) timed.pages.push(p); });
  timed.ready = false;
}
async function doLogin() {
  if (!timed.usuario || !timed.senha) throw new Error('Sessão sem credenciais em memória. Inicie a sessão novamente.');
  await ensureBrowser();
  let page = timed.pages.find(p => !p.isClosed());
  if (!page) { page = await timed.context.newPage(); timed.pages.push(page); }
  await page.goto(TIMED_LOGIN, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#login').fill(timed.usuario, { timeout: 15000 });
  await page.locator('#senha').fill(timed.senha, { timeout: 15000 });
  await page.locator('#btnEntrar').click({ timeout: 15000 });

  // O TIMED pode manter o formulário de login visível quando as credenciais
  // estão incorretas. Não espere 60 segundos por um menu que nunca aparecerá.
  // Dá até 8 segundos para o painel surgir; se a tela de login continuar
  // visível, encerra a tentativa com uma mensagem clara.
  const loginStarted = Date.now();
  const loginCheckLimit = 8000;
  while (Date.now() - loginStarted < loginCheckLimit) {
    const menu = await findVisible(MENU_SELECTORS, 250).catch(() => null);
    if (menu) {
      timed.ready = true;
      return;
    }

    if (await visibleLogin()) {
      const elapsed = Date.now() - loginStarted;
      if (elapsed >= 4000) {
        const messages = [];
        for (const frame of await allFrames()) {
          const bodyText = await frame.locator('body').innerText().catch(() => '');
          if (bodyText) messages.push(bodyText);
        }
        const pageText = messages.join(' ').replace(/\\s+/g, ' ').trim();
        const invalidCredentialHint =
          /usuário ou senha|usuario ou senha|senha inválida|senha invalida|login inválido|login invalido|credenciais inválidas|credenciais invalidas|não foi possível autenticar|nao foi possivel autenticar/i.test(pageText);

        throw new Error(
          invalidCredentialHint
            ? 'O TIMED recusou o acesso. Confira o usuário e a senha e tente novamente.'
            : 'Não foi possível entrar no TIMED. A tela de login continuou aberta; confira usuário e senha e tente novamente.'
        );
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }

  throw new Error('O TIMED não confirmou o login em até 8 segundos. Confira as credenciais e a disponibilidade do sistema.');
}
async function ensurePanel() {
  await ensureBrowser();
  if (await visibleLogin()) {
    timed.ready = false;
    await doLogin();
    return 'login_refeito';
  }
  try {
    // Após goHome(), o menu já foi confirmado. Uma checagem curta é suficiente
    // para detectar se a sessão continua no painel sem gastar 2,5 s por BE.
    await findVisible(MENU_SELECTORS, 700);
    timed.ready = true;
    return 'sessao_reutilizada';
  } catch (_) {
    // Tenta reconhecer se o TIMED retornou ao login ou se a sessão foi perdida.
    if (await visibleLogin()) {
      timed.ready = false;
      await doLogin();
      return 'login_refeito';
    }
    if (!timed.ready) {
      await doLogin();
      return 'login_refeito';
    }
    throw new Error('Não localizei o menu do painel nem a tela de login. A sessão pode estar em uma tela intermediária do TIMED.');
  }
}
async function clickAny(selectors, timeout = TIMEOUT) {
  const found = await findVisible(selectors, timeout);
  await found.locator.click({ timeout: 12000 });
  return found;
}
async function waitForPatientModule(timeout = 60000) {
  // O clique no menu dispara openWindow() e o módulo é carregado de forma assíncrona.
  // Não tente clicar na aba antes de o conteúdo do módulo existir no DOM.
  return await findVisible([
    '#btnPesquisaPadrao',
    '#uiPesquisaBoletimEmergencia',
    '#aPesquisa',
    'a[href="#divDadosPaciente"]'
  ], timeout);
}
async function activateTab(href, label) {
  const tab = await findVisible([
    `a[href="${href}"]`,
    `ul.ui-tabs-nav a[href="${href}"]`
  ], 45000);
  await tab.locator.scrollIntoViewIfNeeded().catch(() => {});
  await tab.locator.click({ timeout: 15000 });
  const started = Date.now();
  while (Date.now() - started < 12000) {
    const active = await tab.locator.evaluate(el => {
      const li = el.closest('li');
      return !!li && (li.classList.contains('ui-tabs-selected') || li.classList.contains('ui-state-active'));
    }).catch(() => false);
    if (active) return tab.frame;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`A aba "${label}" foi localizada, mas não confirmou estado ativo.`);
}
async function readValue(frame, selector) {
  try {
    const loc = frame.locator(selector).first();
    if (!(await loc.count())) return '';
    return await loc.inputValue({ timeout: 2500 }).catch(async () => loc.evaluate(el => (el.value ?? '').toString().trim()));
  } catch (_) { return ''; }
}
async function readSelectedText(frame, selector) {
  try { return await frame.locator(selector).first().evaluate(el => (!el || el.value === '-1') ? '' : (el.selectedOptions?.[0]?.textContent || '').trim()); }
  catch (_) { return ''; }
}
async function extractCpf(frame) {
  return frame.evaluate(() => {
    const root = document.querySelector('#divPacienteDocumentos');
    if (!root) return '';
    for (const block of root.querySelectorAll('[id^="divPacienteDocumento_"]')) {
      const type = block.querySelector('select[name*="tipoDocumentoId"]');
      const label = type?.selectedOptions?.[0]?.textContent?.trim()?.toUpperCase() || '';
      if (type?.value === '4' || label === 'CPF') return (block.querySelector('input[name*="numeroDocumento"]')?.value || '').trim();
    }
    return '';
  }).catch(() => '');
}
async function extractPhones(frame) {
  const pairs = [
    { tipo: 'Celular', ddd: '#uiDddMovel', numero: '#uiNumeroMovel' },
    { tipo: 'Fixo', ddd: '#uiDddFixo', numero: '#uiNumeroFixo' },
    { tipo: 'Extra 1', ddd: '#uiDddExtraUm', numero: '#uiNumeroExtraUm' },
    { tipo: 'Extra 2', ddd: '#uiDddExtraDois', numero: '#uiNumeroExtraDois' }
  ];
  const out = [];
  for (const p of pairs) {
    const ddd = (await readValue(frame, p.ddd)).trim();
    const numero = (await readValue(frame, p.numero)).trim();
    if (numero) out.push({ tipo: p.tipo, ddd, numero, completo: Boolean(ddd) });
    if (out.length === 2) break;
  }
  return out;
}
async function extractPatient() {
  // A aba pessoal já foi ativada pelo fluxo de pesquisa. Não a ativamos
  // novamente: isso evita um clique e uma espera redundantes.
  const name = await findVisible(['#uiNome'], 15000);
  const f = name.frame;
  const patient = await f.evaluate(() => {
    const value = selector => (document.querySelector(selector)?.value ?? '').toString().trim();
    const selected = selector => {
      const el = document.querySelector(selector);
      return !el || el.value === '-1' ? '' : (el.selectedOptions?.[0]?.textContent || '').trim();
    };
    let cpf = '';
    const root = document.querySelector('#divPacienteDocumentos');
    if (root) {
      for (const block of root.querySelectorAll('[id^="divPacienteDocumento_"]')) {
        const type = block.querySelector('select[name*="tipoDocumentoId"]');
        const label = type?.selectedOptions?.[0]?.textContent?.trim()?.toUpperCase() || '';
        if (type?.value === '4' || label === 'CPF') {
          cpf = (block.querySelector('input[name*="numeroDocumento"]')?.value || '').trim();
          break;
        }
      }
    }
    return {
      nome: value('#uiNome'), sexo: selected('#sexo'),
      prontuarioTimed: value('#uiProntuario'), nascimento: value('#uiDataNascimento'),
      racaCor: selected('select[name="racaCorId"]'), cpf,
      cns: value('#uiCns'), mae: value('#uiMaeNome'), endereco: {}, telefones: []
    };
  });
  if (!patient.nome) throw new Error('Aba Dados do paciente ativa, mas #uiNome está vazio. Extração interrompida.');

  await activateTab('#divDadosResidencia', 'Dados da Residência');
  const residence = await findVisible(['#uiCep'], 12000);
  const residenceData = await residence.frame.evaluate(() => {
    const value = selector => (document.querySelector(selector)?.value ?? '').toString().trim();
    const selected = selector => {
      const el = document.querySelector(selector);
      return !el || el.value === '-1' ? '' : (el.selectedOptions?.[0]?.textContent || '').trim();
    };
    const pares = [
      { tipo: 'Celular', ddd: '#uiDddMovel', numero: '#uiNumeroMovel' },
      { tipo: 'Fixo', ddd: '#uiDddFixo', numero: '#uiNumeroFixo' },
      { tipo: 'Extra 1', ddd: '#uiDddExtraUm', numero: '#uiNumeroExtraUm' },
      { tipo: 'Extra 2', ddd: '#uiDddExtraDois', numero: '#uiNumeroExtraDois' }
    ];
    const telefones = [];
    for (const p of pares) {
      const ddd = value(p.ddd), numero = value(p.numero);
      if (numero) telefones.push({ tipo: p.tipo, ddd, numero, completo: Boolean(ddd) });
      if (telefones.length === 2) break;
    }
    return {
      endereco: {
        cep: value('#uiCep'), municipio: value('#uiMunicipioNome'),
        municipioId: value('#uiMunicipioId'), tipoLogradouro: selected('#uiTipoLogradouroId'),
        logradouro: value('#uiLogradouroNome'), logradouroId: value('#uiLogradouroId'),
        numero: value('#uiNumero'), complemento: value('#uiComplementoNome'),
        bairro: value('#uiBairroNome')
      }, telefones
    };
  });
  patient.endereco = residenceData.endereco;
  patient.telefones = residenceData.telefones;
  return patient;
}
async function goHome() {
  const home = await findVisible([
    'img[onclick="home()"]',
    'img[title="Ir para a tela inicial"]',
    'img[src*="/images/house.png"]'
  ], 12000);
  await home.locator.click({ timeout: 10000 });
  await findVisible(MENU_SELECTORS, 30000);
  timed.ready = true;
}
async function runSearch(be) {
  const etapas = {};
  let etapa = now();
  // Abre o módulo pelo menu e espera o carregamento dinâmico do Vitai.
  await clickAny(MENU_SELECTORS, 20000);
  try {
    await waitForPatientModule(60000);
  } catch (e) {
    const diagnostico = [];
    for (const p of timed.pages.filter(p => !p.isClosed())) {
      diagnostico.push({
        url: p.url(),
        titulo: await p.title().catch(() => ''),
        frames: p.frames().map(f => f.url())
      });
    }
    throw new Error(`O menu PESQUISAR PACIENTE foi acionado, mas o módulo não terminou de carregar. Diagnóstico: ${JSON.stringify(diagnostico)}`);
  }
  etapas.aberturaPesquisa = seconds(etapa);
  etapa = now();
  await activateTab('#divDadosPaciente', 'Dados do paciente');
  await clickAny(['#btnPesquisaPadrao'], 20000);
  const beField = await findVisible(['#uiPesquisaBoletimEmergencia'], 20000);
  await beField.locator.fill(be, { timeout: 10000 });
  await clickAny(['#aPesquisa'], 10000);
  let rows = null;
  const started = Date.now();
  while (Date.now() - started < 25000) {
    for (const frame of await allFrames()) {
      const loc = frame.locator('tr[onclick*="genericSelecionaPacienteWithAuditoria"]');
      if (await loc.count().catch(() => 0)) { rows = loc; break; }
    }
    if (rows) break;
    const text = (await Promise.all((await allFrames()).map(f => f.locator('body').innerText().catch(() => '')))).join('\n');
    if (/Total de registros:\s*0/i.test(text) || /Nenhum registro/i.test(text) || /BE não encontrada/i.test(text)) {
      throw Object.assign(new Error('BE não encontrada. Verifique o número digitado.'), { notFound: true });
    }
    // Se o TIMED voltou ao login no meio da consulta, sinaliza para o ciclo externo refazer login e repetir uma vez.
    if (await visibleLogin()) throw Object.assign(new Error('Sessão TIMED expirada durante a pesquisa.'), { expired: true });
    await new Promise(r => setTimeout(r, 300));
  }
  if (!rows) throw new Error('Pesquisa acionada, mas não localizei as linhas de resultado.');
  const quantidadeResultados = await rows.count();
  etapas.pesquisaBE = seconds(etapa);
  etapa = now();
  await rows.first().click({ timeout: 15000 });
  // O Vitai precisa de um breve intervalo para carregar o cadastro após
  // selecionar a linha do resultado. Aguarda 1 segundo antes de procurar
  // e ativar a aba Dados do paciente.
  await new Promise(resolve => setTimeout(resolve, 1000));
  // Reproduz a sequência da versão que funcionava: após selecionar a linha,
  // aguarda o cadastro aparecer (#uiNome) e só então ativa a aba pessoal.
  await findVisible(['#uiNome'], 45000);
  etapas.carregamentoCadastro = seconds(etapa);
  etapa = now();
  await activateTab('#divDadosPaciente', 'Dados do paciente');
  const paciente = await extractPatient();
  etapas.extracaoDados = seconds(etapa);
  return { quantidadeResultados, paciente, etapas };
}

app.post('/api/sessao/iniciar', async (req, res) => {
  if (timed.busy) return res.status(409).json({ erro: 'Aguarde a operação atual terminar.' });
  const usuario = String(req.body?.usuario || '').trim();
  const senha = String(req.body?.senha || '');
  if (!usuario || !senha) return res.status(400).json({ erro: 'Informe usuário e senha do TIMED.' });
  timed.busy = true;
  const start = now();
  try {
    timed.usuario = usuario; timed.senha = senha; timed.ready = false;
    timed.sessionToken = crypto.randomBytes(32).toString('hex');
    await ensureBrowser();
    await doLogin();
    res.json({ sucesso: true, token: timed.sessionToken, tempoLogin: seconds(start), mensagem: 'TIMED autenticado e pronto para receber consultas.' });
  } catch (e) {
    await closeSession();
    res.status(500).json({ erro: e.message || 'Falha ao iniciar sessão.', tempoLogin: seconds(start) });
  } finally { timed.busy = false; }
});

app.post('/api/consultar', requireSessionToken, async (req, res) => {
  const be = String(req.body?.be || '').trim();
  if (!be) return res.status(400).json({ erro: 'Informe o número do BE.' });
  if (!timed.usuario || !timed.senha) return res.status(409).json({ erro: 'Inicie primeiro a sessão TIMED.' });
  if (timed.busy) return res.status(409).json({ erro: 'Já existe uma operação em andamento.' });
  timed.busy = true;
  const total = now(); const tempos = {}; let loginStatus = 'sessao_reutilizada';
  try {
    let t = now();
    loginStatus = await ensurePanel();
    tempos.verificacaoSessao = seconds(t);
    t = now();
    let result;
    try { result = await runSearch(be); }
    catch (err) {
      if (!err.expired) throw err;
      t = now(); await doLogin(); tempos.reloginRecuperacao = seconds(t);
      t = now(); result = await runSearch(be); tempos.pesquisaExtracao = seconds(t);
      loginStatus = 'login_refeito_durante_consulta';
    }
    if (tempos.pesquisaExtracao === undefined) tempos.pesquisaExtracao = seconds(t);
    tempos.etapas = result.etapas;
    t = now(); await goHome(); tempos.retornoTelaInicial = seconds(t);
    tempos.totalConsulta = seconds(total);
    return res.json({ sucesso: true, be, quantidadeResultados: result.quantidadeResultados, sessao: loginStatus, prontoParaProximaConsulta: true, tempos, paciente: result.paciente });
  } catch (err) {
    tempos.totalConsulta = seconds(total);
    // Mesmo em falha, tenta deixar o painel na tela inicial se a sessão ainda estiver válida.
    try { if (timed.ready && !(await visibleLogin())) await goHome(); } catch (_) { timed.ready = false; }
    if (err.notFound) return res.status(404).json({ erro: err.message, tempos, prontoParaProximaConsulta: timed.ready });
    return res.status(500).json({ erro: err.message || 'Falha inesperada.', tempos, prontoParaProximaConsulta: timed.ready });
  } finally { timed.busy = false; }
});

async function closeSession() {
  if (timed.browser) await timed.browser.close().catch(() => {});
  timed.browser = null; timed.context = null; timed.pages = [];
  timed.usuario = null; timed.senha = null; timed.ready = false; timed.sessionToken = null;
}
app.post('/api/sessao/encerrar', requireSessionToken, async (_req, res) => {
  if (timed.busy) return res.status(409).json({ erro: 'Aguarde a operação atual terminar.' });
  await closeSession();
  res.json({ sucesso: true, mensagem: 'Sessão encerrada e credenciais removidas da memória.' });
});
process.on('SIGINT', async () => { await closeSession(); process.exit(0); });
process.on('SIGTERM', async () => { await closeSession(); process.exit(0); });

const port = Number(process.env.PORT || 4173);
app.listen(port, '127.0.0.1', () => console.log(`Teste TIMED disponível em http://127.0.0.1:${port}`));