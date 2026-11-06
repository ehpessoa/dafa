import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
export const isConfigured = Boolean(SUPABASE_URL && KEY);

// A autenticação é do próprio app (tabela app_users + funções RPC); o Supabase Auth não é usado.
export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', KEY || 'public-anon-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** Chama uma função RPC do banco e devolve o resultado (lança Error com a mensagem do banco). */
export async function api<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
