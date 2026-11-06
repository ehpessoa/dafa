// POST /api/reset-request  { email }  → envia por WhatsApp o código de 6 dígitos para redefinir a senha.
// A resposta é sempre a mesma (exista a conta ou não) para não revelar quais e-mails estão cadastrados.
import { firstName, json, rpc, sendWhatsAppText } from './_lib/server';

interface Issue { throttled?: boolean; name?: string; phone?: string; code?: string }

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const body = (await request.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254) return json({ error: 'Informe o e-mail da conta.' }, 400);
    try {
      const issue = await rpc<Issue | null>('app_reset_issue', { p_email: email });
      if (issue?.code && issue.phone) {
        await sendWhatsAppText(issue.phone, [
          `Olá, ${firstName(issue.name ?? '')}! 🔐`,
          '',
          `Seu código para redefinir a senha da *DAFA* é: *${issue.code}*`,
          'Ele vale por 15 minutos. Se não foi você, ignore esta mensagem.',
        ].join('\n'));
      }
      return json({ ok: true });
    } catch (e) {
      console.error('reset-request:', e instanceof Error ? e.message : e);
      return json({ error: 'Não foi possível enviar o código agora. Tente novamente em instantes.' }, 502);
    }
  },
};
