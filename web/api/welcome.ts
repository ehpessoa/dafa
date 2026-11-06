// POST /api/welcome  { token }  → envia a confirmação de cadastro por WhatsApp (uma única vez por conta).
import { firstName, json, rpc, sendWhatsAppText } from './_lib/server';

interface Claim { user_id: string; name: string; email: string; phone: string }

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length !== 64) return json({ error: 'Sessão inválida.' }, 400);
    try {
      const claim = await rpc<Claim | null>('app_welcome_claim', { p_token: body.token });
      if (!claim) return json({ sent: false });                       // já enviada, sem telefone ou sessão inválida
      try {
        await sendWhatsAppText(claim.phone, [
          `Olá, ${firstName(claim.name)}! 🎉`,
          '',
          'Seu cadastro na *DAFA* foi criado com sucesso.',
          `📧 Acesso: ${claim.email}`,
          '',
          'Comece pelo Dia 1 do programa — bons estudos! 📊',
        ].join('\n'));
      } catch (e) {
        await rpc('app_welcome_release', { p_user: claim.user_id }).catch(() => undefined);
        throw e;
      }
      return json({ sent: true });
    } catch (e) {
      console.error('welcome:', e instanceof Error ? e.message : e);
      return json({ error: 'Não foi possível enviar a confirmação por WhatsApp.' }, 502);
    }
  },
};
