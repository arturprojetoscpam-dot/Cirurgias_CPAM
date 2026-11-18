const express = require('express');
const crypto = require('crypto');
const { chromium } = require('playwright');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// A API só aceita chamadas originadas do domínio oficial do CPAM.
// O serviço permanece vinculado exclusivamente a 127.0.0.1.
const CPAM_ORIGINS = new Set([
  'https://cirurgiascpam.vercel.app'
]);
// Aceita previews gerados para este projeto e este escopo Vercel específico.
// Não libera qualquer domínio *.vercel.app nem nomes parecidos de outros projetos.
const CPAM_PREVIEW_HOST = /^cirurgiascpam-[a-z0-9-]+-arturprojetoscpam-dot\.vercel\.app$/i;
function isAuthorizedOrigin(origin) {
  if (CPAM_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' &&
      url.origin === origin &&
      CPAM_PREVIEW_HOST.test(url.hostname);
  } catch (_) {
    return false;
  }
}
const LOCAL_HOST = '127.0.0.1:4173';
app.use('/api', (req, res, next) => {
  const origin = req.get('Origin');
  const host = req.get('Host');
  if (host !== LOCAL_HOST || !isAuthorizedOrigin(origin)) {
    return res.status(403).json({ erro: 'Origem não autorizada para acessar a integração local.' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
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
const timed = { browser: null, context: null, pages: [], usuario: null, senha: null, ready: false, busy: false, sessionToken: null, httpSessionCookie: '', sessionMode: 'none', lastActivityAt: 0 };

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
  timed.httpSessionCookie = '';
  timed.sessionMode = 'browser';
  timed.lastActivityAt = Date.now();
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
        const pageText = messages.join(' ').replace(/\s+/g, ' ').trim();
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
  const sessionIdle = timed.lastActivityAt && Date.now() - timed.lastActivityAt > 15 * 60 * 1000;
  if (timed.sessionMode === 'direct_http' && timed.httpSessionCookie) {
    if (sessionIdle) return await doHttpLogin();
    return 'sessao_http_reutilizada';
  }
  if (timed.sessionMode === 'browser' && sessionIdle) {
    await doLogin();
    return 'login_refeito_por_inatividade';
  }
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

const VITAI_BASE_URL = new URL(TIMED_LOGIN).origin;
const VITAI_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function vitaiSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie') || '';
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=)/g) : [];
}
function mergeVitaiCookies(...groups) {
  const cookies = new Map();
  for (const item of groups.flat()) {
    const first = String(item || '').split(';')[0];
    const index = first.indexOf('=');
    if (index <= 0) continue;
    const name = first.slice(0, index).trim();
    const value = first.slice(index + 1).trim();
    if (name && value) cookies.set(name, value);
  }
  return Array.from(cookies, ([name, value]) => name + '=' + value).join('; ');
}
async function vitaiHttpFetch(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000), cache: 'no-store' });
}
async function doHttpLogin() {
  if (!timed.usuario || !timed.senha) throw new Error('Sessão sem credenciais em memória. Inicie a sessão novamente.');
  const headersBase = { 'User-Agent': VITAI_USER_AGENT };
  const warmUp = await vitaiHttpFetch(TIMED_LOGIN, { method: 'GET', headers: headersBase });
  const initialCookies = vitaiSetCookies(warmUp.headers);
  const params = new URLSearchParams();
  params.append('perform', 'login');
  params.append('controle', '1');
  params.append('login', timed.usuario.trim().toLowerCase());
  params.append('senha', timed.senha);
  const loginResponse = await vitaiHttpFetch(TIMED_LOGIN, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...headersBase,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': VITAI_BASE_URL,
      'Referer': TIMED_LOGIN,
      'Cookie': mergeVitaiCookies(initialCookies)
    },
    body: params
  });
  const responseText = await loginResponse.text();
  let loginData = {};
  try { loginData = JSON.parse(responseText); } catch (_) {}
  if (!loginResponse.ok || loginData.status !== 'ok') {
    throw new Error(typeof loginData.mensagem === 'string' ? loginData.mensagem : 'O VITAI não confirmou a autenticação direta.');
  }
  const cookie = mergeVitaiCookies(initialCookies, vitaiSetCookies(loginResponse.headers));
  if (!cookie) throw new Error('O VITAI autenticou, mas não retornou os cookies necessários para manter a sessão.');
  timed.httpSessionCookie = cookie;
  timed.sessionMode = 'direct_http';
  timed.lastActivityAt = Date.now();
  timed.ready = true;
  return 'direct_http';
}
function decodeVitaiResponse(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch (_) { return new TextDecoder('iso-8859-1').decode(buffer); }
}
function vitaiPickString(data, preferredKeys, fallbackPattern) {
  const normalize = value => {
    if (value === null || value === undefined || typeof value === 'boolean') return '';
    const valueText = String(value).trim();
    if (!valueText || /^(null|undefined|false|true|nan)$/i.test(valueText)) return '';
    return valueText;
  };
  for (const key of preferredKeys) {
    const value = normalize(data && data[key]);
    if (value) return value;
  }
  if (!fallbackPattern) return '';
  const queue = [data];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    for (const [key, raw] of Object.entries(current)) {
      if (fallbackPattern.test(key)) {
        const value = normalize(raw);
        if (value) return value;
      }
      if (raw && typeof raw === 'object') queue.push(raw);
    }
  }
  return '';
}
function vitaiCpfFromText(text) {
  const match = String(text || '').match(/CPF[^0-9]{0,40}(\d{3}\.?\d{3}\.?\d{3}-?\d{2})|numeroCPF[^0-9]{0,40}(\d{11})/i);
  return match ? String(match[1] || match[2]).replace(/\D/g, '') : '';
}
function vitaiBrDateToIso(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? match[3] + '-' + match[2] + '-' + match[1] : '';
}
async function runDirectBeSearch(be) {
  if (!/^\d{1,12}$/.test(String(be))) throw Object.assign(new Error('Número de BE inválido.'), { notFound: true });
  if (!timed.httpSessionCookie) throw new Error('A sessão HTTP do VITAI não está disponível.');
  const started = now();
  const searchParams = new URLSearchParams();
  searchParams.append('perform', 'pesquisar');
  searchParams.append('numeroBE', String(be));
  const boletimParams = new URLSearchParams();
  boletimParams.append('perform', 'pesquisar');
  boletimParams.append('pesquisa', String(be));
  boletimParams.append('dataNascimento', 'undefined');
  boletimParams.append('comAlta', 'N');
  boletimParams.append('interno', 'S');
  boletimParams.append('controle', '26');
  const evolucaoParams = new URLSearchParams();
  evolucaoParams.append('perform', 'pesquisar');
  evolucaoParams.append('controle', '5');
  evolucaoParams.append('boletimEmergenciaId', String(be));
  evolucaoParams.append('itensPrescritosAguardandoLiberacao', 'false');
  const commonHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Cookie': timed.httpSessionCookie,
    'User-Agent': VITAI_USER_AGENT,
    'Origin': VITAI_BASE_URL,
    'X-Requested-With': 'XMLHttpRequest'
  };
  const [searchResponse, boletimResponse, evolucaoResponse] = await Promise.all([
    vitaiHttpFetch(VITAI_BASE_URL + '/vitai/pages/paciente.do', {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': VITAI_BASE_URL + '/vitai/pages/prescricao.do?action=5&modulo=S'
      },
      body: searchParams
    }),
    vitaiHttpFetch(VITAI_BASE_URL + '/vitai/pages/boletimEmergencia.do', {
      method: 'POST',
      headers: { ...commonHeaders, 'Accept': '*/*', 'Referer': VITAI_BASE_URL + '/vitai/pages/evolucaoPacienteInterno.do' },
      body: boletimParams
    }).catch(() => null),
    vitaiHttpFetch(VITAI_BASE_URL + '/vitai/pages/evolucaoPacienteInterno.do', {
      method: 'POST',
      headers: { ...commonHeaders, 'Accept': 'text/html, */*; q=0.01', 'Referer': VITAI_BASE_URL + '/vitai/pages/evolucaoPacienteInterno.do' },
      body: evolucaoParams
    }).catch(() => null)
  ]);
  const rotatedCookie = mergeVitaiCookies(
    timed.httpSessionCookie,
    vitaiSetCookies(searchResponse.headers),
    vitaiSetCookies(boletimResponse ? boletimResponse.headers : new Headers()),
    vitaiSetCookies(evolucaoResponse ? evolucaoResponse.headers : new Headers())
  );
  if (rotatedCookie) timed.httpSessionCookie = rotatedCookie;
  const etapas = { consultaParalela: seconds(started) };
  const mapStarted = now();
  const responseText = decodeVitaiResponse(Buffer.from(await searchResponse.arrayBuffer()));
  if (/login\.do|sess[aã]o.{0,40}(expir|inv[aá]lid)|autentica[cç][aã]o.{0,30}(expir|necess[aá]ria)/i.test(responseText) || searchResponse.status === 401 || searchResponse.status === 403) {
    throw Object.assign(new Error('Sessão VITAI expirada durante a consulta.'), { expired: true });
  }
  if (!searchResponse.ok) throw new Error('A pesquisa direta do VITAI respondeu com status ' + searchResponse.status + '.');
  let record;
  try { record = JSON.parse(responseText); }
  catch (_) { throw new Error('A resposta direta do VITAI não veio em JSON. Será necessário usar a consulta pelo navegador.'); }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('O VITAI retornou um formato de paciente inesperado.');
  }
  let boletimHtml = '';
  if (boletimResponse && boletimResponse.ok) boletimHtml = new TextDecoder('iso-8859-1').decode(await boletimResponse.arrayBuffer()).slice(0, 300000);
  let evolucaoHtml = '';
  if (evolucaoResponse && evolucaoResponse.ok) evolucaoHtml = new TextDecoder('iso-8859-1').decode(await evolucaoResponse.arrayBuffer()).slice(0, 300000);
  const nome = vitaiPickString(record, ['nome'], /^(nome|nomePaciente)$/i);
  const numeroBE = vitaiPickString(record, ['numeroBE', 'be'], /numeroBE/i);
  if (!nome) {
    throw Object.assign(new Error('BE não encontrada no VITAI. Verifique o número informado.'), { notFound: true });
  }
  if (numeroBE && numeroBE.replace(/\D/g, '') !== String(be).replace(/\D/g, '')) {
    throw new Error('O VITAI retornou um cadastro com BE diferente da solicitada. Será usada a consulta pelo navegador.');
  }
  const cpf = vitaiPickString(record, ['numeroCPF', 'numeroCpf', 'CPF', 'cpf'], /cpf/i) || vitaiCpfFromText(responseText) || vitaiCpfFromText(boletimHtml);
  const phones = [
    { tipo: 'Celular', ddd: vitaiPickString(record, ['dddMovel']), numero: vitaiPickString(record, ['numeroMovel', 'celular']) },
    { tipo: 'Fixo', ddd: vitaiPickString(record, ['dddFixo']), numero: vitaiPickString(record, ['numeroFixo']) },
    { tipo: 'Extra 1', ddd: vitaiPickString(record, ['dddExtraUm']), numero: vitaiPickString(record, ['numeroExtraUm']) },
    { tipo: 'Extra 2', ddd: vitaiPickString(record, ['dddExtraDois']), numero: vitaiPickString(record, ['numeroExtraDois']) }
  ].filter(item => item.numero).slice(0, 2).map(item => ({ ...item, completo: Boolean(item.ddd) }));
  const endereco = {
    cep: vitaiPickString(record, ['cep']),
    municipio: vitaiPickString(record, ['municipioNome', 'municipio']),
    municipioId: vitaiPickString(record, ['municipioId']),
    tipoLogradouro: vitaiPickString(record, ['tipoLogradouroNome', 'tipoLogradouro']),
    logradouro: vitaiPickString(record, ['logradouroNome', 'logradouro']),
    logradouroId: vitaiPickString(record, ['logradouroId']),
    numero: vitaiPickString(record, ['numeroLogradouro', 'numero']),
    complemento: vitaiPickString(record, ['complementoNome', 'complemento']),
    bairro: vitaiPickString(record, ['bairroNome', 'bairro'])
  };
  const paciente = {
    nome,
    sexo: vitaiPickString(record, ['sexo']),
    prontuarioTimed: vitaiPickString(record, ['numeroProntuario', 'prontuario', 'numeroPront'], /pront/i),
    nascimento: vitaiPickString(record, ['dataNascimento', 'nascimento']),
    racaCor: vitaiPickString(record, ['racaCorNome', 'racaCor']),
    cpf,
    cns: vitaiPickString(record, ['numeroCns', 'numeroCNS', 'CNS', 'cns'], /cns/i),
    mae: vitaiPickString(record, ['maeNome', 'nomeMae'], /maeNome|nomeMae/i),
    endereco,
    telefones: phones
  };
  const admissao = vitaiPickString(record, ['dataInternacao', 'dataInternação', 'dataEntrada'], /interna[cç][aã]o/i) ||
    boletimHtml.match(/INTERNA[CÇ][AÃ]O\s*:?\s*(?:<[^>]*>\s*)*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || '';
  paciente.admissaoDate = vitaiBrDateToIso(admissao);
  paciente.leito = evolucaoHtml.match(/Leito\s*:\s*(?:<[^>]*>\s*)*[^<]*?-\s*(?:<[^>]*>\s*)*([A-Za-z]{0,2}\d{1,4}[A-Za-z]?)\b/i)?.[1]?.toUpperCase() || '';
  etapas.mapeamentoDados = seconds(mapStarted);
  return { quantidadeResultados: 1, paciente, etapas };
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
    await closeSession();
    timed.usuario = usuario; timed.senha = senha; timed.ready = false;
    timed.sessionToken = crypto.randomBytes(32).toString('hex');
    let modo = 'direct_http';
    try {
      await doHttpLogin();
    } catch (httpError) {
      // Compatibilidade: se o endpoint de login direto mudar, mantém o acesso atual via Playwright.
      modo = 'playwright_fallback';
      await ensureBrowser();
      await doLogin();
    }
    res.json({ sucesso: true, token: timed.sessionToken, tempoLogin: seconds(start), modo, mensagem: 'TIMED autenticado e pronto para receber consultas.' });
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
    if (timed.sessionMode === 'direct_http' && timed.httpSessionCookie) {
      try {
        result = await runDirectBeSearch(be);
      } catch (err) {
        if (err.notFound) throw err;
        if (err.expired) {
          t = now();
          await doHttpLogin();
          tempos.reloginRecuperacao = seconds(t);
          t = now();
          result = await runDirectBeSearch(be);
          loginStatus = 'sessao_http_renovada';
        } else {
          // Se a resposta direta for incompatível, tenta o fluxo já validado pelo navegador.
          t = now();
          await doLogin();
          tempos.fallbackPlaywright = seconds(t);
          t = now();
          result = await runSearch(be);
          loginStatus = 'fallback_playwright';
        }
      }
    } else {
      try { result = await runSearch(be); }
      catch (err) {
        if (!err.expired) throw err;
        t = now(); await doLogin(); tempos.reloginRecuperacao = seconds(t);
        t = now(); result = await runSearch(be); tempos.pesquisaExtracao = seconds(t);
        loginStatus = 'login_refeito_durante_consulta';
      }
    }
    if (tempos.pesquisaExtracao === undefined) tempos.pesquisaExtracao = seconds(t);
    tempos.etapas = result.etapas;
    if (timed.sessionMode === 'browser') {
      t = now(); await goHome(); tempos.retornoTelaInicial = seconds(t);
    }
    tempos.totalConsulta = seconds(total);
    timed.lastActivityAt = Date.now();
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
  timed.usuario = null; timed.senha = null; timed.ready = false; timed.sessionToken = null; timed.httpSessionCookie = ''; timed.sessionMode = 'none'; timed.lastActivityAt = 0;
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