// POST /api/phone-change-send  { token, password, phone }
// Confere a senha atual e envia por WhatsApp, para o NOVO número, o código que confirma a troca.
import { firstName, json, rpc, sendWhatsAppText } from './_lib/server.js';

interface Issue { error?: string; throttled?: boolean; name?: string; phone?: string; code?: string }

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    if (str(b.token).length !== 64) return json({ error: 'Sessão inválida. Entre novamente.' }, 401);
    let issue: Issue;
    try {
      issue = await rpc<Issue>('app_phone_change_issue', { p_token: str(b.token), p_password: str(b.password), p_phone: str(b.phone) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Não foi possível iniciar a troca.' }, 400);
    }
    if (issue.error) return json({ error: issue.error }, 400);
    if (issue.throttled) return json({ error: 'Aguarde 1 minuto para pedir um novo código.' }, 429);
    try {
      await sendWhatsAppText(issue.phone ?? '', [
        `Olá, ${firstName(issue.name ?? '')}! 📲`,
        '',
        `Seu código para confirmar o novo WhatsApp na *DAFA* é: *${issue.code}*`,
        'Ele vale por 15 minutos. Se não foi você, ignore esta mensagem.',
      ].join('\n'));
    } catch (e) {
      console.error('phone-change-send:', e instanceof Error ? e.message : e);
      return json({ error: 'Não foi possível enviar o código agora. Tente novamente em instantes.' }, 502);
    }
    return json({ ok: true });
  },
};
