// Camada HTTP da função grade-submissions (autenticação, CORS, parâmetros). Testável fora do Deno.
import { runBatch, DEFAULT_MODEL } from './grader.mjs';

const CORS = {
  'access-control-allow-origin': '*',   // a autenticação é por token no corpo (sem cookies)
  'access-control-allow-headers': 'content-type, authorization, apikey, x-client-info, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

/** Comparação em tempo constante. */
function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

/**
 * req: Request · env: { GEMINI_API_KEY, GEMINI_MODEL?, CRON_SECRET? }
 * db: { teacherId(token), pendingCount(), claim(...), apply(...), fail(...) } · fetchImpl: fetch do Gemini (injetável) · attach: {fetchImpl, unzip} para ler arquivos/links dos alunos
 * Acionamentos: (1) tutor logado — body {token}; (2) agendador — header x-cron-secret.
 */
export async function handleRequest(req, { env, db, fetchImpl, attach }) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Corpo JSON inválido.' }); }

  let trigger, runBy = null;
  const cron = req.headers.get('x-cron-secret');
  if (cron !== null) {
    if (!env.CRON_SECRET || !safeEqual(cron, env.CRON_SECRET)) return json(401, { error: 'Segredo do agendador inválido.' });
    trigger = 'scheduled';
  } else {
    try { runBy = await db.teacherId(body?.token); trigger = 'manual'; }
    catch (e) { return json(/Apenas tutores/.test(String(e?.message)) ? 403 : 401, { error: e instanceof Error ? e.message : 'Não autorizado.' }); }
  }

  if (body?.action === 'status') return json(200, { pending: await db.pendingCount() });

  if (!env.GEMINI_API_KEY) return json(500, { error: 'GEMINI_API_KEY não está configurada na função (supabase secrets set GEMINI_API_KEY=…).' });
  const ids = Array.isArray(body?.submission_ids) && body.submission_ids.length
    ? body.submission_ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 25) : null;
  const limit = Math.min(25, Math.max(1, Number(body?.limit) || 10));
  try {
    const gemini = { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || DEFAULT_MODEL, fetchImpl, attach };
    let result = await runBatch({ db, trigger, runBy, limit, ids, gemini });
    // Job agendado (1x/dia): esvazia a fila em lotes, dentro de um orçamento de tempo. Só entra o que AINDA está em
    // "submitted" no momento da reserva — o que o tutor já decidiu nesse meio-tempo não é reprocessado.
    if (trigger === 'scheduled' && !ids) {
      const deadline = Date.now() + (Number(env.GRADE_BUDGET_MS) || 110000);
      for (let round = 1; round < 20 && result.claimed >= limit && Date.now() < deadline; round++) {
        const more = await runBatch({ db, trigger, runBy, limit, ids, gemini, skipErrors: true });
        if (!more.claimed) break;
        for (const k of ['claimed', 'auto_approved', 'sent_to_tutor', 'discarded']) result[k] += more[k];
        result.errors.push(...more.errors); result.results.push(...more.results);
      }
    }
    return json(200, { trigger, ...result });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
}
