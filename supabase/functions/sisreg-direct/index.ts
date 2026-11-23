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
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function stripHtml(value: string) {
  return decodeEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function extractPatient(html: string, requested: string) {
  const fields: Record<string, string> = {};
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = row.match(/<(?:th|td)\b[^>]*>[\s\S]*?<\/(?:th|td)>/gi) || [];
    if (cells.length >= 2) {
      const label = stripHtml(cells[0]).replace(/[:\s]+$/, "").toLocaleLowerCase("pt-BR");
      const value = stripHtml(cells.slice(1).join(" "));
      if (label && value && label.length < 90 && value.length < 300) fields[label] = value;
    }
  }
  const text = stripHtml(html);
  const pick = (patterns: RegExp[]) => {
    for (const [label, value] of Object.entries(fields)) if (patterns.some((p) => p.test(label)) && value) return value;
    const match = text.match(new RegExp("(?:^|\\s)(?:" + patterns.map((p) => p.source).join("|") + ")\\s*:?\\s*([^]{1,100}?)(?=\\s{2,}|$)", "i"));
    return match?.[1]?.trim() || "";
  };
  const nome = pick([/nome(?: completo)?(?: do paciente)?/i]);
  if (!nome) {
    if (/nenhum registro|não encontrado|nao encontrado|sem resultado/i.test(text)) throw new Error("Nenhum cadastro foi localizado no SISREG para o identificador informado.");
    throw new Error("O SISREG respondeu, mas não foi possível identificar com segurança os campos do paciente.");
  }
  return {
    nome,
    nascimento: pick([/data de nascimento|nascimento/i]),
    cpf: (pick([/cpf/i]).replace(/\D/g, "").match(/\d{11}/)?.[0] || ""),
    cns: (pick([/cns|cart[aã]o nacional de sa[uú]de|cart[aã]o sus/i]).replace(/\D/g, "").match(/\d{15}/)?.[0] || ""),
    mae: pick([/nome da m[aã]e|m[aã]e/i]),
    campos: fields,
    trecho: text.slice(0, 1200),
    identificadorConsultado: requested,
  };
}
async function searchSisreg(identifier: string, cookie: string) {
  const started = performance.now();
  const headers = { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*", "Cookie": cookie, "Referer": SISREG_LOGIN_URL };
  const page = await sisregFetch(SISREG_CADWEB_URL, { headers });
  const pageHtml = decode(await page.arrayBuffer());
  if (loginFormVisible(pageHtml) || page.status === 401 || page.status === 403) throw new Error("SESSION_EXPIRED");
  if (!page.ok) throw new Error("Não foi possível abrir a consulta de pacientes do SISREG (HTTP " + page.status + ").");
  const formMatch = pageHtml.match(/<form\b([^>]*)>([\s\S]*?)<\/form>/i);
  if (!formMatch) throw new Error("O SISREG não apresentou o formulário de consulta esperado.");
  const attrs = formMatch[1], formInner = formMatch[2];
  const actionMatch = attrs.match(/\baction\s*=\s*["']([^"']*)["']/i);
  let action = actionMatch?.[1] ? new URL(decodeEntities(actionMatch[1]), SISREG_CADWEB_URL).toString() : SISREG_CADWEB_URL;
  if (action.startsWith("http://")) action = action.replace(/^http:/i, "https:");
  const params = new URLSearchParams();
  const inputRegex = /<input\b([^>]*)>/gi; let input: RegExpExecArray | null;
  while ((input = inputRegex.exec(formInner)) !== null) {
    const a = input[1], name = a.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    const type = a.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() || "text";
    const value = a.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    if (type === "hidden" || type === "submit") params.set(name, decodeEntities(value));
  }
  params.set("nu_cns", identifier);
  params.set("btn_pesquisar", "Pesquisar");
  const result = await sisregFetch(action, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", "Origin": SISREG_BASE_URL },
    body: params,
  });
  const resultHtml = decode(await result.arrayBuffer());
  if (loginFormVisible(resultHtml) || result.status === 401 || result.status === 403) throw new Error("SESSION_EXPIRED");
  if (!result.ok) throw new Error("A pesquisa SISREG respondeu com erro HTTP " + result.status + ".");
  return { paciente: extractPatient(resultHtml, identifier), cookie: mergeCookies([cookie], setCookies(page.headers), setCookies(result.headers)), elapsedMs: Math.round(performance.now() - started) };
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
