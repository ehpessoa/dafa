// Edge Function: anexos do aluno (Supabase Storage, bucket privado `submission-files`) e validação de links públicos.
// Deploy: supabase functions deploy submission-files --no-verify-jwt   (autenticação própria: token da sessão do app)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';
import { handleFiles } from '../_shared/files.mjs';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKET = 'submission-files';
async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

const db = {
  actor: (token: string, exercise?: string) => rpc('file_actor', { p_token: token, p_exercise: exercise ?? null }),
  register: (user: string, exercise: string, name: string, mime: string, size: number, path: string) =>
    rpc('file_register', { p_user: user, p_exercise: exercise, p_name: name, p_mime: mime, p_size: size, p_path: path }),
  deletePending: (user: string, id: string) => rpc('file_pending_delete', { p_user: user, p_id: id }),
  access: (token: string, id: string) => rpc('file_access', { p_token: token, p_id: id }),
  linkBegin: (token: string) => rpc('link_check_begin', { p_token: token }),
  linkSave: (user: string, url: string, r: { ok: boolean; kind?: string; detail?: string; warning?: string }) =>
    rpc('link_check_save', { p_user: user, p_url: url, p_ok: r.ok, p_kind: r.kind ?? null, p_detail: r.detail ?? null, p_warning: r.warning ?? null }),
};
const storage = {
  async upload(path: string, bytes: Uint8Array, mime: string) {
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (error) throw new Error('Falha ao guardar o arquivo: ' + error.message);
  },
  async remove(paths: string[]) { await admin.storage.from(BUCKET).remove(paths); },
  async signedUrl(path: string, seconds: number) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds);
    if (error || !data) throw new Error('Não foi possível gerar o link do arquivo.');
    return data.signedUrl;
  },
};

Deno.serve((req) => handleFiles(req, { db, storage, fetchImpl: fetch, unzip: { unzipSync, strFromU8 } }));
