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

export interface GradeResult {
  trigger: string; claimed: number; auto_approved: number; sent_to_tutor: number; discarded: number;
  errors: { submission_id: string; error: string }[];
}
/** Aciona a correção por IA (Edge Function grade-submissions). Só tutores autenticados. */
export async function gradeSubmissions(token: string, opts: { submission_ids?: string[]; limit?: number } = {}): Promise<GradeResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/grade-submissions`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ token, ...opts }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Falha ao acionar a correção por IA (HTTP ${res.status}).`);
  return body as GradeResult;
}
export async function pendingForAi(token: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/grade-submissions`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ token, action: 'status' }),
  });
  if (!res.ok) throw new Error('indisponível');
  return ((await res.json()) as { pending: number }).pending;
}

// ───── Anexos e validação de links (Edge Function submission-files) ─────
const FILES_URL = `${SUPABASE_URL}/functions/v1/submission-files`;
const fnHeaders = { apikey: KEY, authorization: `Bearer ${KEY}` };
async function filesCall<T>(init: RequestInit): Promise<T> {
  const res = await fetch(FILES_URL, { method: 'POST', ...init, headers: { ...fnHeaders, ...(init.headers as Record<string, string> | undefined) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Falha na operação (HTTP ${res.status}).`);
  return body as T;
}
const jsonCall = <T,>(body: Record<string, unknown>) => filesCall<T>({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface LinkResult { ok: boolean; kind?: string; detail?: string; warning?: string }
export const checkLink = (token: string, url: string) => jsonCall<LinkResult>({ action: 'check-link', token, url });
export const uploadFile = (token: string, exerciseId: string, file: File) => {
  const f = new FormData(); f.set('token', token); f.set('exercise_id', exerciseId); f.set('file', file);
  return filesCall<{ id: string; name: string; size: number }>({ body: f });
};
export const deleteFile = (token: string, fileId: string) => jsonCall<{ deleted: boolean }>({ action: 'delete-file', token, file_id: fileId });
export const fileUrl = (token: string, fileId: string) => jsonCall<{ name: string; url: string }>({ action: 'file-url', token, file_id: fileId });
