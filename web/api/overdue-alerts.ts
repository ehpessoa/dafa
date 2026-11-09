// POST /api/overdue-alerts  (agendador: pg_cron + pg_net, dias úteis 09:00 de Brasília)
//   header  x-cron-secret: <mesmo valor do segredo "dafa_cron_secret" do Vault>
//   corpo   { "force": true }  → ignora a regra de fim de semana (testes manuais)
// Avisa por WhatsApp (e o banco cria a notificação no app) os alunos com entrega semanal vencida, e resume para os tutores.
import { json, rpc, sendWhatsAppText } from './_lib/server.js';
import { runOverdueAlerts } from './_lib/overdue.js';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const secret = request.headers.get('x-cron-secret') ?? '';
    let ok = false;
    try { ok = await rpc<boolean>('cron_secret_ok', { p_secret: secret }); } catch { ok = false; }
    if (!ok) return json({ error: 'Não autorizado.' }, 401);

    const body = (await request.json().catch(() => ({}))) as { force?: unknown };
    try {
      const summary = await runOverdueAlerts({
        rpc, send: sendWhatsAppText,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        appUrl: (process.env.APP_URL ?? '').trim() || 'https://dafa-rho.vercel.app',
      }, body.force === true);
      return json(summary);
    } catch (e) {
      console.error('overdue-alerts:', e instanceof Error ? e.message : e);
      return json({ error: 'Falha ao processar os alertas.' }, 500);
    }
  },
};
