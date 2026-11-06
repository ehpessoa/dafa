// POST /api/invite-send  { token, name, email, phone }  (token = sessão do TUTOR)
// Cria o convite personalizado e envia por WhatsApp o link do app com o token do convite.
import { firstName, json, rpc, sendWhatsAppText } from './_lib/server';

interface Issued { id: string; invite: string; name: string; phone: string }

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    if (str(b.token).length !== 64) return json({ error: 'Sessão inválida. Entre novamente.' }, 401);

    let issued: Issued;
    try {
      issued = await rpc<Issued>('app_invite_issue', { p_token: str(b.token), p_name: str(b.name), p_email: str(b.email), p_phone: str(b.phone) });
    } catch (e) {
      // Erros de validação do banco (e-mail inválido, aluno já cadastrado, limite...) são mensagens para o tutor.
      return json({ error: e instanceof Error ? e.message : 'Não foi possível criar o convite.' }, 400);
    }

    const base = (process.env.APP_URL ?? '').trim() || new URL(request.url).origin;
    const link = `${base.replace(/\/$/, '')}/?convite=${issued.invite}`;
    try {
      await sendWhatsAppText(issued.phone, [
        `Olá, ${firstName(issued.name)}! 👋`,
        '',
        'Você foi convidado(a) para o treinamento de *Análise de Dados da DAFA* 📊',
        '',
        'Toque no link abaixo, escolha sua senha e confirme para criar sua conta:',
        link,
        '',
        'O convite é pessoal e vale por 7 dias.',
      ].join('\n'));
    } catch (e) {
      await rpc('app_invite_revoke_by_id', { p_id: issued.id }).catch(() => undefined);
      console.error('invite-send:', e instanceof Error ? e.message : e);
      return json({ error: 'Não foi possível enviar o WhatsApp agora. Tente novamente em instantes.' }, 502);
    }
    return json({ ok: true });
  },
};
