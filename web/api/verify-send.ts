// POST /api/verify-send  { token }  → envia por WhatsApp o código de 6 dígitos que verifica o número do cadastro.
import { firstName, json, rpc, sendWhatsAppText } from './_lib/server';

interface Issue { throttled?: boolean; name?: string; phone?: string; code?: string }

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length !== 64) return json({ error: 'Sessão inválida.' }, 400);
    try {
      const issue = await rpc<Issue | null>('app_verify_issue', { p_token: body.token });
      if (!issue) return json({ error: 'Sessão inválida ou WhatsApp já verificado.' }, 400);
      if (issue.throttled) return json({ error: 'Aguarde 1 minuto para pedir um novo código.' }, 429);
      await sendWhatsAppText(issue.phone ?? '', [
        `Olá, ${firstName(issue.name ?? '')}! 👋`,
        '',
        `Seu código de verificação da *DAFA* é: *${issue.code}*`,
        'Ele vale por 15 minutos. Se não foi você, ignore esta mensagem.',
      ].join('\n'));
      return json({ ok: true });
    } catch (e) {
      console.error('verify-send:', e instanceof Error ? e.message : e);
      return json({ error: 'Não foi possível enviar o código agora. Tente novamente em instantes.' }, 502);
    }
  },
};
