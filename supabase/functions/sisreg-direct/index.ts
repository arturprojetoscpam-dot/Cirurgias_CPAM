const SISREG_BASE_URL = "https://sisregiii.saude.gov.br";
const SISREG_LOGIN_URL = SISREG_BASE_URL + "/cgi-bin/index";
const SISREG_CADWEB_URL = SISREG_BASE_URL + "/cgi-bin/cadweb50?standalone=1";
const SESSION_IDLE_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = origin === "https://cirurgiascpam.vercel.app" ||
    /^https:\/\/cirurgiascpam-[a-z0-9-]+-arturprojetoscpam-dot\.vercel\.app$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://cirurgiascpam.vercel.app",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}
async function dbRequest(path: string, init: RequestInit = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Configuração administrativa do Supabase ausente.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...init,
    headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": "Bearer " + SUPABASE_SERVICE_KEY, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Falha ao acessar o armazenamento seguro da integração (" + response.status + ").");
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function authenticate(req: Request) {
  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !SUPABASE_ANON_KEY || !SUPABASE_URL) return null;
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + token },
    cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (!user?.id) return null;
  const profiles = await dbRequest("user_profiles?user_id=eq." + encodeURIComponent(user.id) + "&select=active&limit=1");
  if (!Array.isArray(profiles) || profiles[0]?.active !== true) return null;
  return { userId: String(user.id) };
}
function keyBytes() {
  const hex = Deno.env.get("SISREG_ENCRYPTION_KEY") || "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("A chave de criptografia SISREG ainda não foi configurada no Supabase.");
  return new Uint8Array(hex.match(/.{2}/g)!.map((v) => parseInt(v, 16)));
}
function toBase64(bytes: Uint8Array) {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
}
function fromBase64(value: string) { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
async function encrypt(value: unknown) {
  const key = await crypto.subtle.importKey("raw", keyBytes(), "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}
async function decrypt(nonce: string, ciphertext: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes(), "AES-GCM", false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(nonce) }, key, fromBase64(ciphertext));
  return JSON.parse(new TextDecoder().decode(clear));
}
function setCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const combined = headers.get("set-cookie") || "";
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=)/g) : [];
}
function mergeCookies(...groups: string[][]) {
  const map = new Map<string, string>();
  for (const item of groups.flat()) {
    const first = String(item || "").split(";")[0], index = first.indexOf("=");
    if (index <= 0) continue;
    const name = first.slice(0, index).trim(), value = first.slice(index + 1).trim();
    if (name && value) map.set(name, value);
  }
  return Array.from(map, ([name, value]) => name + "=" + value).join("; ");
}
async function sisregFetch(url: string, options: RequestInit = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
}
function decode(buffer: ArrayBuffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("iso-8859-1").decode(buffer); }
}
async function sha256Upper(value: string) {
  const bytes = new TextEncoder().encode(value.toLocaleUpperCase("pt-BR"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
function loginFormVisible(html: string) {
  return /name=["']usuario["']/i.test(html) && /name=["']senha(?:_256)?["']/i.test(html);
}
async function loginSisreg(usuario: string, senha: string) {
  const headers = { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
  const warmup = await sisregFetch(SISREG_LOGIN_URL, { method: "GET", headers });
  let cookies = setCookies(warmup.headers);
  const body = new URLSearchParams();
  body.set("usuario", usuario.trim());
  body.set("senha_256", await sha256Upper(senha));
  body.set("etapa", "ACESSO");
  body.set("logout", "");
  const response = await sisregFetch(SISREG_LOGIN_URL, {
    method: "POST", redirect: "manual",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", "Origin": SISREG_BASE_URL, "Referer": SISREG_LOGIN_URL, "Cookie": mergeCookies(cookies) },
    body,
  });
  cookies = [ ...cookies, ...setCookies(response.headers) ];
  let responseText = decode(await response.arrayBuffer());
  let location = response.headers.get("location") || "";
  if (response.status >= 300 && response.status < 400 && location) {
    if (location.startsWith("http://")) location = location.replace(/^http:/i, "https:");
    else location = new URL(location, SISREG_BASE_URL).toString();
    const landing = await sisregFetch(location, { headers: { ...headers, "Cookie": mergeCookies(cookies), "Referer": SISREG_LOGIN_URL } });
    cookies = [ ...cookies, ...setCookies(landing.headers) ];
    responseText = decode(await landing.arrayBuffer());
  }
  const cookie = mergeCookies(cookies);
  if (!response.ok && !(response.status >= 300 && response.status < 400)) throw new Error("O SISREG respondeu com erro HTTP " + response.status + " durante o login.");
  if (!cookie) throw new Error("O SISREG não retornou os cookies necessários para manter a sessão.");
  if (loginFormVisible(responseText) || /usu[aá]rio.{0,30}(inv[aá]lido|incorreto)|senha.{0,30}(inv[aá]lida|incorreta)/i.test(responseText)) {
    throw new Error("O SISREG não confirmou o login. Confira usuário e senha.");
  }
  return cookie;
}
async function readCredentials(userId: string) {
  const rows = await dbRequest("sisreg_credentials?user_id=eq." + encodeURIComponent(userId) + "&select=nonce,encrypted_payload&limit=1");
  if (!Array.isArray(rows) || !rows[0]) return null;
  return await decrypt(rows[0].nonce, rows[0].encrypted_payload) as { usuario: string; senha: string };
}
async function saveSession(userId: string, cookie: string) {
  const encrypted = await encrypt({ cookie });
  const now = new Date(), expiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  await dbRequest("sisreg_sessions?on_conflict=user_id", {
    method: "POST", headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, nonce: encrypted.nonce, encrypted_payload: encrypted.ciphertext, expires_at: expiresAt.toISOString(), last_activity_at: now.toISOString(), updated_at: now.toISOString() }),
  });
}
async function getSession(userId: string) {
  const rows = await dbRequest("sisreg_sessions?user_id=eq." + encodeURIComponent(userId) + "&select=nonce,encrypted_payload,expires_at,last_activity_at&limit=1");
  if (!Array.isArray(rows) || !rows[0]) return null;
  const row = rows[0], now = Date.now(), expiry = Date.parse(row.expires_at), lastActivity = Date.parse(row.last_activity_at);
  if (!Number.isFinite(expiry) || !Number.isFinite(lastActivity) || expiry <= now || now - lastActivity > SESSION_IDLE_MS) return null;
  const value = await decrypt(row.nonce, row.encrypted_payload) as { cookie: string };
  return value.cookie || null;
}
function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">",
    aacute: "á", acirc: "â", atilde: "ã", agrave: "à", auml: "ä",
    eacute: "é", ecirc: "ê", egrave: "è", euml: "ë",
    iacute: "í", icirc: "î", igrave: "ì", iuml: "ï",
    oacute: "ó", ocirc: "ô", otilde: "õ", ograve: "ò", ouml: "ö",
    uacute: "ú", ucirc: "û", ugrave: "ù", uuml: "ü",
    ccedil: "ç", yacute: "ý", ordm: "º", ordf: "ª",
    ndash: "–", mdash: "—", bull: "•", hellip: "…",
  };
  let decoded = value;
  for (let pass = 0; pass < 3; pass++) {
    const next = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, code) => {
      if (code[0] === "#") {
        const hex = code[1]?.toLowerCase() === "x";
        const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
        try { return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity; }
        catch { return entity; }
      }
      return named[code.toLowerCase()] ?? entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}
function stripHtml(value: string) {
  return decodeEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function normalizeLabel(value: string) {
  return decodeEntities(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}
function htmlAttributes(source: string) {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  return attrs;
}
// Replica a captura estruturada do content.js: campos, tabelas e texto da tela CADWEB.
function extractCadwebJson(html: string) {
  const campos: Array<{ campo: string; valor: string }> = [];
  const labelsByFor = new Map<string, string>();
  const labelRe = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let labelMatch: RegExpExecArray | null;
  while ((labelMatch = labelRe.exec(html)) !== null) {
    const attrs = htmlAttributes(labelMatch[1]);
    const label = stripHtml(labelMatch[2]);
    if (attrs.for && label) labelsByFor.set(attrs.for, label);
  }
  const inputRe = /<(input|select|textarea)\b([^>]*)>(?:([\s\S]*?)<\/\1\s*>)?/gi;
  let inputMatch: RegExpExecArray | null;
  while ((inputMatch = inputRe.exec(html)) !== null) {
    const tag = inputMatch[1].toLowerCase(), attrs = htmlAttributes(inputMatch[2]);
    const type = (attrs.type || "text").toLowerCase();
    if (type === "password" || type === "hidden") continue;
    let rotulo = (attrs.id && labelsByFor.get(attrs.id)) || attrs.name || attrs.id || attrs["aria-label"] || "";
    let valor = attrs.value || "";
    if (tag === "textarea") valor = stripHtml(inputMatch[3] || "");
    if (tag === "select") {
      const options = inputMatch[3] || "";
      const selected = options.match(/<option\b([^>]*)>([\s\S]*?)<\/option>/i);
      if (selected) valor = stripHtml(selected[2]);
    }
    if (rotulo || valor) campos.push({ campo: rotulo, valor: decodeEntities(valor).trim() });
  }
  const tabelas: string[][][] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const linhas: string[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
      const celulas: string[] = [];
      const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) celulas.push(stripHtml(cellMatch[1]));
      if (celulas.some(Boolean)) linhas.push(celulas);
    }
    if (linhas.length) tabelas.push(linhas);
  }
  const titulo = stripHtml((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1]);
  const texto = decodeEntities(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:tr|p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  return { titulo, campos, tabelas, texto };
}
function safeCadwebDiagnostics(html: string, url: string, status: number | null = null, contentType = "") {
  const title = stripHtml((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1]).slice(0, 120);
  const inputNames: string[] = [];
  const inputRe = /<(input|select|textarea)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(html)) !== null) {
    const a = htmlAttributes(m[2]);
    if (a.name) inputNames.push(a.name.slice(0, 80));
  }
  const labels: string[] = [];
  const labelRe = /<label\b[^>]*>([\s\S]*?)<\/label>/gi;
  while ((m = labelRe.exec(html)) !== null) {
    const label = stripHtml(m[1]).slice(0, 80);
    if (label) labels.push(label);
  }
  const forms: string[] = [];
  const formRe = /<form\b([^>]*)>/gi;
  while ((m = formRe.exec(html)) !== null) {
    const a = htmlAttributes(m[1]);
    forms.push((a.method || "get").toUpperCase() + " " + (a.action || "(mesma página)").slice(0, 120));
  }
  const frames: string[] = [];
  const frameRe = /<(?:iframe|frame)\b([^>]*)>/gi;
  while ((m = frameRe.exec(html)) !== null) {
    const src = htmlAttributes(m[1]).src;
    if (src) { try { frames.push(new URL(src, url).pathname); } catch {} }
  }
  let path = "";
  try { path = new URL(url).pathname; } catch {}
  return {
    path, status, contentType, htmlLength: html.length, title,
    inputNames: [...new Set(inputNames)].slice(0, 40),
    labels: [...new Set(labels)].slice(0, 40),
    forms: forms.slice(0, 15), frames: frames.slice(0, 20),
    hasCadwebTitle: /CONSULTA AO CADASTRO DE PACIENTES SUS/i.test(title),
    hasCnsInput: /name=["']nu_cns["']/i.test(html),
    hasNameWord: /\bnome\b/i.test(stripHtml(html)),
    hasPatientTable: /<table\b/i.test(html),
  };
}
function extractPatient(html: string, requested: string) {
  const dados = extractCadwebJson(html);
  const pares: Array<{ label: string; value: string }> = [];
  for (const item of dados.campos) {
    if (item.campo && item.valor) pares.push({ label: normalizeLabel(item.campo), value: item.valor });
  }
  for (const tabela of dados.tabelas) {
    for (const linha of tabela) {
      for (let i = 0; i + 1 < linha.length; i++) {
        if (linha[i] && linha[i + 1]) pares.push({ label: normalizeLabel(linha[i]), value: linha[i + 1] });
      }
    }
  }
  const aliases: Record<string, string[]> = {
    nome: ["nome", "nome completo", "nome do paciente", "paciente"],
    nascimento: ["data de nascimento", "nascimento", "dt nascimento"],
    cpf: ["cpf", "numero cpf"],
    cns: ["cns", "cartao sus", "cartao nacional de saude", "numero cns"],
    mae: ["nome da mae", "mae", "filiacao materna"],
  };
  const pick = (key: string) => {
    const names = aliases[key];
    for (const alias of names) {
      const found = pares.find((p) => p.label === alias ||
        (key !== "nome" && p.label.startsWith(alias + " ")));
      if (found?.value) return found.value.trim();
    }
    const lines = dados.texto.split(/\n+/).map((v) => v.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = normalizeLabel(lines[i]).replace(/:$/, "");
      const matches = names.some((alias) => line === alias ||
        (key !== "nome" && line.startsWith(alias + " ")));
      if (matches) {
        const inline = lines[i].split(/[:：]/).slice(1).join(":").trim();
        if (inline) return inline;
        if (lines[i + 1]) return lines[i + 1].trim();
      }
    }
    return "";
  };
  const nome = pick("nome");
  const textNorm = normalizeLabel(dados.texto);
  if (!nome) {
    if (/nenhum registro|nao encontrado|sem resultado/.test(textNorm)) throw new Error("Nenhum cadastro foi localizado no SISREG para o identificador informado.");
    throw new Error("O SISREG respondeu, mas a captura estruturada da tela CADWEB não encontrou o campo Nome. A resposta foi preservada para diagnóstico sem expor dados do paciente.");
  }
  const digitos = (value: string) => value.replace(/\D/g, "");
  return {
    nome,
    nascimento: pick("nascimento"),
    cpf: digitos(pick("cpf")).match(/\d{11}/)?.[0] || (requested.length === 11 ? requested : ""),
    cns: digitos(pick("cns")).match(/\d{15}/)?.[0] || (requested.length === 15 ? requested : ""),
    mae: pick("mae"),
    campos: pares.reduce((acc, item) => { if (item.label && item.value) acc[item.label] = item.value; return acc; }, {} as Record<string, string>),
    identificadorConsultado: requested,
  };
}
type SisregPage = { url: string; html: string };

function extractPageReferences(html: string, baseUrl: string) {
  const refs: Array<{ url: string; priority: number }> = [];
  const add = (raw: string, priority: number) => {
    if (!raw || /^(javascript:|#|mailto:)/i.test(raw.trim())) return;
    try {
      const url = new URL(decodeEntities(raw.trim()), baseUrl);
      if (url.hostname !== new URL(SISREG_BASE_URL).hostname) return;
      refs.push({ url: url.toString(), priority });
    } catch {}
  };
  const frameRe = /<(?:iframe|frame)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = frameRe.exec(html)) !== null) {
    const src = htmlAttributes(match[1]).src;
    if (src) add(src, 0);
  }
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  while ((match = linkRe.exec(html)) !== null) {
    const attrs = htmlAttributes(match[1]);
    const label = normalizeLabel(stripHtml(match[2]) + " " + (attrs.title || "") + " " + (attrs.alt || "") + " " + (attrs.onclick || ""));
    if (/\bcns\b/.test(label) || /cns/i.test(attrs.href || "")) add(attrs.href || "", 1);
  }
  return refs.sort((a, b) => a.priority - b.priority);
}

async function findCadwebPage(startUrl: string, cookie: string, headers: Record<string, string>) {
  const queue = [startUrl];
  const visited = new Set<string>();
  const pages: SisregPage[] = [];
  while (queue.length && visited.size < 30) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    let response: Response;
    try { response = await sisregFetch(url, { headers: { ...headers, "Cookie": cookie } }); }
    catch { continue; }
    if (loginFormVisible(await response.clone().text()) || response.status === 401 || response.status === 403) {
      throw new Error("SESSION_EXPIRED");
    }
    if (!response.ok) continue;
    const html = decode(await response.arrayBuffer());
    pages.push({ url: response.url || url, html });
    if (/<input\b[^>]*\bname\s*=\s*["']nu_cns["']/i.test(html)) {
      return { page: pages[pages.length - 1], pages, cookies: setCookies(response.headers) };
    }
    for (const ref of extractPageReferences(html, response.url || url)) {
      if (!visited.has(ref.url) && !queue.includes(ref.url)) queue.push(ref.url);
    }
  }
  return { page: null as SisregPage | null, pages, cookies: [] as string[] };
}

async function searchSisreg(identifier: string, cookie: string) {
  const started = performance.now();
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Cookie": cookie,
    "Referer": SISREG_LOGIN_URL,
  };

  // Primeiro reproduzimos diretamente o clique no link CNS da tela inicial:
  // GET /cgi-bin/cadweb50?standalone=1, mantendo os cookies da sessão.
  // Se o SISREG depender da navegação pelo menu/frame, usamos a página inicial como fallback.
  let navigation = await findCadwebPage(SISREG_CADWEB_URL, cookie, {
    ...headers,
    "Referer": SISREG_LOGIN_URL,
  });
  if (!navigation.page) {
    const fromIndex = await findCadwebPage(SISREG_LOGIN_URL, cookie, headers);
    navigation = {
      page: fromIndex.page,
      pages: [...navigation.pages, ...fromIndex.pages],
      cookies: [...navigation.cookies, ...fromIndex.cookies],
    };
  }
  if (!navigation.page) {
    const hasCadwebTitle = navigation.pages.some((p) => /CONSULTA AO CADASTRO DE PACIENTES SUS/i.test(stripHtml(p.html)));
    throw new Error(hasCadwebTitle
      ? "O SISREG abriu a área CADWEB, mas o campo de pesquisa não foi localizado nas páginas e frames consultados."
      : "O SISREG autenticou, mas a opção CNS e o formulário de pesquisa não foram encontrados nas páginas e frames disponíveis.");
  }

  const page = navigation.page;
  const formMatch = page.html.match(/<form\b([^>]*)>([\s\S]*?)<\/form>/i);
  if (!formMatch) throw new Error("A página do SISREG contém o campo CNS, mas não apresentou o formulário correspondente.");
  const attrs = htmlAttributes(formMatch[1]), formInner = formMatch[2];
  let action = attrs.action ? new URL(attrs.action, page.url).toString() : page.url;
  if (action.startsWith("http://")) action = action.replace(/^http:/i, "https:");

  const params = new URLSearchParams();
  const inputRegex = /<input\b([^>]*)>/gi;
  let input: RegExpExecArray | null;
  while ((input = inputRegex.exec(formInner)) !== null) {
    const a = htmlAttributes(input[1]);
    if (!a.name) continue;
    const type = (a.type || "text").toLowerCase();
    if (type === "hidden" || type === "submit") params.set(a.name, a.value || "");
  }
  params.set("nu_cns", identifier);
  params.set("btn_pesquisar", "Pesquisar");

  const result = await sisregFetch(action, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": SISREG_BASE_URL,
      "Referer": page.url,
    },
    body: params,
  });
  const resultHtml = decode(await result.arrayBuffer());
  if (loginFormVisible(resultHtml) || result.status === 401 || result.status === 403) throw new Error("SESSION_EXPIRED");
  if (!result.ok) throw new Error("A pesquisa SISREG respondeu com erro HTTP " + result.status + ".");

  // O resultado também pode estar em um frame diferente do formulário.
  const resultTree = await findCadwebPage(result.url || action, mergeCookies([cookie], setCookies(result.headers)), headers);
  const candidatePages = [ { url: result.url || action, html: resultHtml }, ...resultTree.pages ];
  const resultPage = candidatePages.find((p) => /CONSULTA AO CADASTRO DE PACIENTES SUS/i.test(stripHtml(p.html))) ||
    candidatePages.find((p) => /nome\s*(?:do\s*)?paciente|data de nascimento|cart[aã]o nacional de sa[uú]de/i.test(stripHtml(p.html))) ||
    candidatePages[0];

  let paciente;
  try {
    paciente = extractPatient(resultPage.html, identifier);
  } catch (error) {
    // Diagnóstico estrutural: nunca registra HTML, valores de campos ou dados do paciente.
    const diagnostics = candidatePages.map((p) => safeCadwebDiagnostics(p.html, p.url));
    console.error("sisreg-direct: CADWEB_STRUCTURE_DIAGNOSTICS", JSON.stringify({
      resultStatus: result.status,
      resultContentType: result.headers.get("content-type") || "",
      resultUrlPath: (() => { try { return new URL(result.url || action).pathname; } catch { return ""; } })(),
      candidateCount: candidatePages.length,
      candidates: diagnostics.slice(0, 12),
      error: error instanceof Error ? error.message : "Falha de extração",
    }));
    throw error;
  }
  return {
    paciente,
    cookie: mergeCookies([cookie], navigation.cookies, setCookies(result.headers), resultTree.cookies),
    elapsedMs: Math.round(performance.now() - started),
  };
}
async function handle(req: Request) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const origin = req.headers.get("Origin") || "";
  if (origin && headers["Access-Control-Allow-Origin"] !== origin) return json(req, { error: "Origem não autorizada." }, 403);
  if (req.method !== "POST") return json(req, { error: "Método não permitido." }, 405);
  const auth = await authenticate(req);
  if (!auth) return json(req, { error: "Sessão CPAM inválida ou usuário inativo." }, 401);
  const userId = auth.userId, action = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) || "";
  try {
    if (action === "status") {
      const rows = await dbRequest("sisreg_credentials?user_id=eq." + encodeURIComponent(userId) + "&select=user_id&limit=1");
      if (!Array.isArray(rows) || !rows[0]) return json(req, { configured: false, connected: false });
      return json(req, { configured: true, connected: Boolean(await getSession(userId)) });
    }
    if (action === "configure") {
      const body = await req.json(), usuario = String(body.usuario || "").trim(), senha = String(body.senha || "");
      if (!usuario || !senha || usuario.length > 200 || senha.length > 500) return json(req, { error: "Informe usuário e senha SISREG válidos." }, 400);
      const cookie = await loginSisreg(usuario, senha);
      const encrypted = await encrypt({ usuario, senha }), now = new Date().toISOString();
      await dbRequest("sisreg_credentials?on_conflict=user_id", {
        method: "POST", headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: userId, nonce: encrypted.nonce, encrypted_payload: encrypted.ciphertext, updated_at: now, last_validated_at: now, last_validation_ok: true }),
      });
      await saveSession(userId, cookie);
      return json(req, { ok: true, configured: true, connected: true });
    }
    if (action === "search") {
      const body = await req.json(), identifier = String(body.identificador || "").replace(/\D/g, "");
      const tipo = String(body.tipo || "");
      if ((tipo === "cns" && identifier.length !== 15) || (tipo === "cpf" && identifier.length !== 11) || !["cns", "cpf"].includes(tipo)) {
        return json(req, { error: tipo === "cns" ? "Informe um CNS com 15 números." : "Informe um CPF com 11 números." }, 400);
      }
      const credentials = await readCredentials(userId);
      if (!credentials) return json(req, { error: "Configure seu acesso SISREG antes de consultar pacientes." }, 409);
      let cookie = await getSession(userId), reused = Boolean(cookie);
      if (!cookie) cookie = await loginSisreg(credentials.usuario, credentials.senha);
      let result;
      try { result = await searchSisreg(identifier, cookie); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "SESSION_EXPIRED") throw error;
        cookie = await loginSisreg(credentials.usuario, credentials.senha);
        reused = false;
        result = await searchSisreg(identifier, cookie);
      }
      await saveSession(userId, result.cookie);
      return json(req, { paciente: result.paciente, sessaoReutilizada: reused, tempoConsultaMs: result.elapsedMs });
    }
    return json(req, { error: "Rota não encontrada." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha interna na integração SISREG.";
    console.error("sisreg-direct:", message);
    return json(req, { error: message }, /não encontrado|não foi localizado/i.test(message) ? 404 : 502);
  }
}
Deno.serve(handle);
