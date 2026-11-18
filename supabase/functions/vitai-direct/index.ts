const VITAI_BASE_URL = Deno.env.get("VITAI_BASE_URL") || "https://hiam.vitai.care";
const VITAI_LOGIN_URL = VITAI_BASE_URL + "/vitai/pages/login.do";
const SESSION_IDLE_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
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
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
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
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (!user?.id) return null;
  const profiles = await dbRequest("user_profiles?user_id=eq." + encodeURIComponent(user.id) + "&select=active&limit=1");
  if (!Array.isArray(profiles) || profiles[0]?.active !== true) return null;
  return { userId: String(user.id) };
}
function keyBytes() {
  const hex = Deno.env.get("VITAI_ENCRYPTION_KEY") || "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("A chave de criptografia VITAI não está configurada corretamente.");
  return new Uint8Array(hex.match(/.{2}/g)!.map((v) => parseInt(v, 16)));
}
function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
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
    const first = String(item || "").split(";")[0];
    const index = first.indexOf("=");
    if (index <= 0) continue;
    const name = first.slice(0, index).trim();
    const value = first.slice(index + 1).trim();
    if (name && value) map.set(name, value);
  }
  return Array.from(map, ([name, value]) => name + "=" + value).join("; ");
}
async function vitaiFetch(url: string, options: RequestInit = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
}
async function loginVitai(username: string, password: string) {
  const baseHeaders = { "User-Agent": USER_AGENT };
  const warmup = await vitaiFetch(VITAI_LOGIN_URL, { method: "GET", headers: baseHeaders });
  const initialCookies = setCookies(warmup.headers);
  const params = new URLSearchParams();
  params.append("perform", "login");
  params.append("controle", "1");
  params.append("login", username.trim().toLowerCase());
  params.append("senha", password);
  const response = await vitaiFetch(VITAI_LOGIN_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...baseHeaders,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": VITAI_BASE_URL,
      "Referer": VITAI_LOGIN_URL,
      "Cookie": mergeCookies(initialCookies),
    },
    body: params,
  });
  const responseText = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(responseText); } catch { /* resposta não JSON */ }
  if (!response.ok || payload.status !== "ok") {
    throw new Error(typeof payload.mensagem === "string" ? payload.mensagem : "O VITAI não confirmou a autenticação. Confira usuário e senha.");
  }
  const cookie = mergeCookies(initialCookies, setCookies(response.headers));
  if (!cookie) throw new Error("O VITAI autenticou, mas não retornou os cookies necessários para manter a sessão.");
  return cookie;
}
async function readCredentials(userId: string) {
  const rows = await dbRequest("vitai_credentials?user_id=eq." + encodeURIComponent(userId) + "&select=nonce,encrypted_payload&limit=1");
  if (!Array.isArray(rows) || !rows[0]) return null;
  return await decrypt(rows[0].nonce, rows[0].encrypted_payload) as { usuario: string; senha: string };
}
async function saveSession(userId: string, cookie: string) {
  const encrypted = await encrypt({ cookie });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  await dbRequest("vitai_sessions?on_conflict=user_id", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      nonce: encrypted.nonce,
      encrypted_payload: encrypted.ciphertext,
      expires_at: expiresAt.toISOString(),
      last_activity_at: now.toISOString(),
      updated_at: now.toISOString(),
    }),
  });
}
async function getSession(userId: string) {
  const rows = await dbRequest("vitai_sessions?user_id=eq." + encodeURIComponent(userId) + "&select=nonce,encrypted_payload,expires_at,last_activity_at&limit=1");
  if (!Array.isArray(rows) || !rows[0]) return null;
  const row = rows[0];
  const now = Date.now();
  const expiry = Date.parse(row.expires_at);
  const lastActivity = Date.parse(row.last_activity_at);
  if (!Number.isFinite(expiry) || !Number.isFinite(lastActivity) || expiry <= now || now - lastActivity > SESSION_IDLE_MS) return null;
  const value = await decrypt(row.nonce, row.encrypted_payload) as { cookie: string };
  return value.cookie || null;
}
function pickString(data: unknown, preferred: string[], fallback?: RegExp) {
  const normalize = (value: unknown) => {
    if (value === null || value === undefined || typeof value === "boolean") return "";
    const text = String(value).trim();
    return !text || /^(null|undefined|false|true|nan)$/i.test(text) ? "" : text;
  };
  const root = data as Record<string, unknown> | null;
  for (const key of preferred) {
    const value = normalize(root?.[key]);
    if (value) return value;
  }
  if (!fallback || !root) return "";
  const queue: unknown[] = [root];
  const visited = new Set<object>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current as object)) continue;
    visited.add(current as object);
    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      if (fallback.test(key)) {
        const value = normalize(raw);
        if (value) return value;
      }
      if (raw && typeof raw === "object") queue.push(raw);
    }
  }
  return "";
}
function cpfFromText(value: string) {
  const match = value.match(/CPF[^0-9]{0,40}(\d{3}\.?\d{3}\.?\d{3}-?\d{2})|numeroCPF[^0-9]{0,40}(\d{11})/i);
  return match ? String(match[1] || match[2]).replace(/\D/g, "") : "";
}
function brDateToIso(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? match[3] + "-" + match[2] + "-" + match[1] : "";
}
function decode(buffer: ArrayBuffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("iso-8859-1").decode(buffer); }
}
async function searchWithCookie(be: string, cookie: string) {
  const searchParams = new URLSearchParams();
  searchParams.append("perform", "pesquisar");
  searchParams.append("numeroBE", be);
  const boletimParams = new URLSearchParams();
  boletimParams.append("perform", "pesquisar");
  boletimParams.append("pesquisa", be);
  boletimParams.append("dataNascimento", "undefined");
  boletimParams.append("comAlta", "N");
  boletimParams.append("interno", "S");
  boletimParams.append("controle", "26");
  const evolucaoParams = new URLSearchParams();
  evolucaoParams.append("perform", "pesquisar");
  evolucaoParams.append("controle", "5");
  evolucaoParams.append("boletimEmergenciaId", be);
  evolucaoParams.append("itensPrescritosAguardandoLiberacao", "false");
  const common = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Cookie": cookie,
    "User-Agent": USER_AGENT,
    "Origin": VITAI_BASE_URL,
    "X-Requested-With": "XMLHttpRequest",
  };
  const started = performance.now();
  const [main, boletim, evolucao] = await Promise.all([
    vitaiFetch(VITAI_BASE_URL + "/vitai/pages/paciente.do", {
      method: "POST",
      headers: { ...common, "Accept": "application/json, text/javascript, */*; q=0.01", "Referer": VITAI_BASE_URL + "/vitai/pages/prescricao.do?action=5&modulo=S" },
      body: searchParams,
    }),
    vitaiFetch(VITAI_BASE_URL + "/vitai/pages/boletimEmergencia.do", {
      method: "POST",
      headers: { ...common, "Accept": "*/*", "Referer": VITAI_BASE_URL + "/vitai/pages/evolucaoPacienteInterno.do" },
      body: boletimParams,
    }).catch(() => null),
    vitaiFetch(VITAI_BASE_URL + "/vitai/pages/evolucaoPacienteInterno.do", {
      method: "POST",
      headers: { ...common, "Accept": "text/html, */*; q=0.01", "Referer": VITAI_BASE_URL + "/vitai/pages/evolucaoPacienteInterno.do" },
      body: evolucaoParams,
    }).catch(() => null),
  ]);
  const rotatedCookie = mergeCookies(
    [cookie],
    setCookies(main.headers),
    boletim ? setCookies(boletim.headers) : [],
    evolucao ? setCookies(evolucao.headers) : [],
  );
  const text = decode(await main.arrayBuffer());
  if (/login\.do|sess[aã]o.{0,40}(expir|inv[aá]lid)|autentica[cç][aã]o.{0,30}(expir|necess[aá]ria)/i.test(text) || main.status === 401 || main.status === 403) {
    throw new Error("SESSION_EXPIRED");
  }
  if (!main.ok) throw new Error("A pesquisa direta do VITAI respondeu com status " + main.status + ".");
  let record: Record<string, unknown>;
  try { record = JSON.parse(text); }
  catch { throw new Error("A resposta direta do VITAI não veio em JSON."); }
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("O VITAI retornou um formato de paciente inesperado.");
  const boletimHtml = boletim?.ok ? new TextDecoder("iso-8859-1").decode(await boletim.arrayBuffer()).slice(0, 300000) : "";
  const evolucaoHtml = evolucao?.ok ? new TextDecoder("iso-8859-1").decode(await evolucao.arrayBuffer()).slice(0, 300000) : "";
  const nome = pickString(record, ["nome"], /^(nome|nomePaciente)$/i);
  const numeroBE = pickString(record, ["numeroBE", "be"], /numeroBE/i);
  if (!nome) throw new Error("BE não encontrada no VITAI. Verifique o número informado.");
  if (numeroBE && numeroBE.replace(/\D/g, "") !== be.replace(/\D/g, "")) throw new Error("O VITAI retornou um cadastro com BE diferente da solicitada.");
  const cpf = pickString(record, ["numeroCPF", "numeroCpf", "CPF", "cpf"], /cpf/i) || cpfFromText(text) || cpfFromText(boletimHtml);
  const phones = [
    { tipo: "Celular", ddd: pickString(record, ["dddMovel"]), numero: pickString(record, ["numeroMovel", "celular"]) },
    { tipo: "Fixo", ddd: pickString(record, ["dddFixo"]), numero: pickString(record, ["numeroFixo"]) },
    { tipo: "Extra 1", ddd: pickString(record, ["dddExtraUm"]), numero: pickString(record, ["numeroExtraUm"]) },
    { tipo: "Extra 2", ddd: pickString(record, ["dddExtraDois"]), numero: pickString(record, ["numeroExtraDois"]) },
  ].filter((item) => item.numero).slice(0, 2).map((item) => ({ ...item, completo: Boolean(item.ddd) }));
  const endereco = {
    cep: pickString(record, ["cep"]),
    municipio: pickString(record, ["municipioNome", "municipio"]),
    municipioId: pickString(record, ["municipioId"]),
    tipoLogradouro: pickString(record, ["tipoLogradouroNome", "tipoLogradouro"]),
    logradouro: pickString(record, ["logradouroNome", "logradouro"]),
    logradouroId: pickString(record, ["logradouroId"]),
    numero: pickString(record, ["numeroLogradouro", "numero"]),
    complemento: pickString(record, ["complementoNome", "complemento"]),
    bairro: pickString(record, ["bairroNome", "bairro"]),
  };
  const paciente: Record<string, unknown> = {
    nome,
    sexo: pickString(record, ["sexo"]),
    prontuarioTimed: pickString(record, ["numeroProntuario", "prontuario", "numeroPront"], /pront/i),
    nascimento: pickString(record, ["dataNascimento", "nascimento"]),
    racaCor: pickString(record, ["racaCorNome", "racaCor"]),
    cpf,
    cns: pickString(record, ["numeroCns", "numeroCNS", "CNS", "cns"], /cns/i),
    mae: pickString(record, ["maeNome", "nomeMae"], /maeNome|nomeMae/i),
    endereco,
    telefones: phones,
  };
  const admissao = pickString(record, ["dataInternacao", "dataInternação", "dataEntrada"], /interna[cç][aã]o/i) ||
    boletimHtml.match(/INTERNA[CÇ][AÃ]O\s*:?\s*(?:<[^>]*>\s*)*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || "";
  paciente.admissaoDate = brDateToIso(admissao);
  paciente.leito = evolucaoHtml.match(/Leito\s*:\s*(?:<[^>]*>\s*)*[^<]*?-\s*(?:<[^>]*>\s*)*([A-Za-z]{0,2}\d{1,4}[A-Za-z]?)\b/i)?.[1]?.toUpperCase() || "";
  return { paciente, cookie: rotatedCookie, tempos: { consultaParalelaMs: Math.round(performance.now() - started) } };
}
async function handle(req: Request) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const origin = req.headers.get("Origin") || "";
  if (origin && headers["Access-Control-Allow-Origin"] !== origin) return json(req, { error: "Origem não autorizada." }, 403);
  if (req.method !== "POST") return json(req, { error: "Método não permitido." }, 405);
  const auth = await authenticate(req);
  if (!auth) return json(req, { error: "Sessão CPAM inválida ou usuário inativo." }, 401);
  const userId = auth.userId;
  const action = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) || "";
  try {
    if (action === "status") {
      const rows = await dbRequest("vitai_credentials?user_id=eq." + encodeURIComponent(userId) + "&select=user_id&limit=1");
      if (!Array.isArray(rows) || !rows[0]) return json(req, { configured: false, connected: false });
      const session = await getSession(userId);
      return json(req, { configured: true, connected: Boolean(session) });
    }
    if (action === "configure") {
      const body = await req.json();
      const usuario = String(body.usuario || "").trim();
      const senha = String(body.senha || "");
      if (!usuario || !senha || usuario.length > 200 || senha.length > 500) return json(req, { error: "Informe usuário e senha VITAI válidos." }, 400);
      const cookie = await loginVitai(usuario, senha);
      const encrypted = await encrypt({ usuario, senha });
      const now = new Date().toISOString();
      await dbRequest("vitai_credentials?on_conflict=user_id", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          user_id: userId, nonce: encrypted.nonce, encrypted_payload: encrypted.ciphertext,
          updated_at: now, last_validated_at: now, last_validation_ok: true,
        }),
      });
      await saveSession(userId, cookie);
      return json(req, { ok: true, configured: true, connected: true });
    }
    if (action === "search") {
      const body = await req.json();
      const be = String(body.be || "").trim();
      if (!/^\d{1,12}$/.test(be)) return json(req, { error: "Informe um número de BE válido." }, 400);
      const credentials = await readCredentials(userId);
      if (!credentials) return json(req, { error: "Configure seu acesso VITAI antes de consultar a BE." }, 409);
      let cookie = await getSession(userId);
      let sessionReused = Boolean(cookie);
      if (!cookie) cookie = await loginVitai(credentials.usuario, credentials.senha);
      let result;
      try {
        result = await searchWithCookie(be, cookie);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "SESSION_EXPIRED") throw error;
        cookie = await loginVitai(credentials.usuario, credentials.senha);
        sessionReused = false;
        result = await searchWithCookie(be, cookie);
      }
      await saveSession(userId, result.cookie);
      return json(req, { paciente: result.paciente, tempos: result.tempos, sessaoReutilizada: sessionReused });
    }
    return json(req, { error: "Rota não encontrada." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha interna na integração VITAI.";
    console.error("vitai-direct:", message);
    const status = /BE não encontrada/i.test(message) ? 404 : 502;
    return json(req, { error: message }, status);
  }
}
Deno.serve(handle);
