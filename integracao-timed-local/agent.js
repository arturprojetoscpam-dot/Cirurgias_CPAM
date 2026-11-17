// Agente de saída CPAM ↔ Supabase ↔ TIMED.
// Executar no mesmo computador em que o server.js (127.0.0.1:4173) está ativo.
// Não registra credenciais nem dados de pacientes em logs.

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://uazilxyspnycvntxcxzu.supabase.co").replace(/\/$/, "");
const AGENT_TOKEN = process.env.VITAI_AGENT_TOKEN || "";
const LOCAL_BASE = "http://127.0.0.1:4173";
const CPAM_ORIGIN = "https://cirurgiascpam.vercel.app";
const POLL_MS = 2000;

if (!AGENT_TOKEN) {
  console.error("VITAI_AGENT_TOKEN não está definido nas variáveis de ambiente do Windows.");
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function request(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function local(path, body, sessionToken = "") {
  const headers = { "Content-Type": "application/json", Origin: CPAM_ORIGIN };
  if (sessionToken) headers["X-CPAM-Session"] = sessionToken;
  return request(LOCAL_BASE + path, { method: "POST", headers, body: JSON.stringify(body) }, 240000);
}

async function complete(jobId, success, result = null, error = null) {
  return request(SUPABASE_URL + "/functions/v1/vitai-relay/agent-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-vitai-agent-token": AGENT_TOKEN },
    body: JSON.stringify({ job_id: jobId, success, result, error: error ? String(error).slice(0, 450) : null })
  });
}

async function processJob(job) {
  let token = "";
  let result = null;
  let failure = null;
  try {
    const session = await local("/api/sessao/iniciar", {
      usuario: job.credentials.usuario,
      senha: job.credentials.senha
    }, "");
    token = session.token;

    if (job.type === "search_be") {
      const data = await local("/api/consultar", { be: job.payload.be }, token);
      result = { paciente: data.paciente, quantidadeResultados: data.quantidadeResultados, tempos: data.tempos };
    } else if (job.type === "check_status") {
      result = { connected: true, checked_at: new Date().toISOString() };
    } else if (job.type === "validate_credentials") {
      result = { validated: true, checked_at: new Date().toISOString() };
    } else {
      throw new Error("Tipo de tarefa não reconhecido pelo agente.");
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "Falha na integração local.";
  } finally {
    if (token) {
      try { await local("/api/sessao/encerrar", {}, token); }
      catch (_) { /* token expira ao encerrar processo local; não registrar segredo */ }
    }
  }
  await complete(job.id, !failure, result, failure);
}

async function main() {
  console.log("Agente CPAM ativo. Aguardando tarefas seguras do Supabase...");
  while (!stopping) {
    try {
      const data = await request(SUPABASE_URL + "/functions/v1/vitai-relay/agent-poll", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vitai-agent-token": AGENT_TOKEN },
        body: "{}"
      });
      if (data.job) {
        console.log("Tarefa VITAI recebida:", data.job.type);
        await processJob(data.job);
        console.log("Tarefa VITAI finalizada.");
      } else {
        await sleep(POLL_MS);
      }
    } catch (error) {
      console.error("Falha de comunicação com o relay ou serviço local:", error instanceof Error ? error.message : "erro");
      await sleep(5000);
    }
  }
  console.log("Agente CPAM encerrado.");
}

main().catch(error => {
  console.error("Falha ao iniciar agente:", error instanceof Error ? error.message : "erro");
  process.exit(1);
});
