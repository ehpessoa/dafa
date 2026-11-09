// Utilitários das funções serverless (Vercel). Rodam só no servidor: as chaves abaixo NÃO têm prefixo
// VITE_ e nunca chegam ao navegador.
//   EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE  → Evolution API (WhatsApp)
//   SUPABASE_URL (ou VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY → chama as RPCs restritas

const env = (k: string) => (process.env[k] ?? '').trim();

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/** Chama uma função RPC do Supabase com a service_role. */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Servidor sem SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { message?: string } | null)?.message ?? `Supabase HTTP ${res.status}`);
  return data as T;
}

/** Envia texto pelo WhatsApp via Evolution API (POST /message/sendText/{instance}). `phone` já vem com DDI. */
export async function sendWhatsAppText(phone: string, text: string): Promise<void> {
  const base = env('EVOLUTION_API_URL'), key = env('EVOLUTION_API_KEY'), instance = env('EVOLUTION_INSTANCE');
  if (!base || !key || !instance) throw new Error('Servidor sem EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE.');
  const number = phone.replace(/\D/g, '');
  if (number.length < 12) throw new Error('Número de WhatsApp inválido.');
  const res = await fetch(`${base.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key },
    body: JSON.stringify({ number, text }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = (data as { message?: unknown }).message;
    throw new Error(typeof msg === 'string' ? msg : `Evolution API HTTP ${res.status}`);
  }
}

export const firstName = (full: string) => full.trim().split(/\s+/)[0] || 'aluno';
