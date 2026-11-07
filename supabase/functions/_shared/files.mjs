// Edge Function submission-files: anexos do aluno (Storage privado) e validação de links públicos.
// Ações:  multipart {token, exercise_id, file}          → anexa um arquivo
//         json {action:'check-link', token, url}         → valida o link (registra o resultado; app_submit o exige)
//         json {action:'delete-file', token, file_id}    → remove um anexo ainda não enviado
//         json {action:'file-url', token, file_id}       → URL assinada (5 min) para o dono ou o tutor
import { validateLink, MAX_BYTES } from './attachments.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const text = (b) => { try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; } };
const zip = (b) => b[0] === 0x50 && b[1] === 0x4b;
const IMGS = { png: (b) => b[0] === 0x89 && b[1] === 0x50, jpg: (b) => b[0] === 0xff && b[1] === 0xd8, gif: (b) => b[0] === 0x47 && b[1] === 0x49, webp: (b) => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 };
/** Extensões aceitas e verificação do conteúdo (não confia só no nome). */
export const ALLOWED = {
  xlsx: zip, xlsm: zip, pptx: zip, docx: zip, pbix: zip, pbit: zip,
  pdf: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  png: IMGS.png, jpg: IMGS.jpg, jpeg: IMGS.jpg, gif: IMGS.gif, webp: IMGS.webp,
  py: text, sql: text, dax: text, csv: text, txt: text, md: text, ipynb: text, json: text,
};
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ipynb: 'application/json', json: 'application/json', csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export const cleanName = (n) => String(n ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim().slice(0, 150) || 'arquivo';

/**
 * db: { actor(token, exercise?) → {id, role}, register(...) → id, deletePending(user, id) → path|null, access(token, id) → {path,name,mime},
 *       linkBegin(token) → userId, linkSave(userId, url, result) }
 * storage: { upload(path, bytes, mime), remove(paths), signedUrl(path, seconds) } · fetchImpl/unzip: para validar links
 */
export async function handleFiles(req, { db, storage, fetchImpl, unzip, newId = () => crypto.randomUUID() }) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const fail = (e, fallback = 400) => json(/Sessão (inválida|expirada)/.test(e?.message ?? '') ? 401 : /Apenas/.test(e?.message ?? '') ? 403 : fallback, { error: e instanceof Error ? e.message : String(e) });
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      if (Number(req.headers.get('content-length')) > MAX_BYTES + 200000) return json(413, { error: `Arquivo maior que ${MAX_BYTES / 1048576} MB.` });
      const form = await req.formData();
      const file = form.get('file'), exercise = String(form.get('exercise_id') ?? ''), token = String(form.get('token') ?? '');
      if (!file || typeof file === 'string') return json(400, { error: 'Envie um arquivo.' });
      const actor = await db.actor(token, exercise);
      const name = cleanName(file.name), ext = (name.match(/\.([A-Za-z0-9]+)$/) ?? [, ''])[1].toLowerCase();
      if (!ALLOWED[ext]) return json(400, { error: `Tipo de arquivo não aceito (.${ext || '?'}). Aceitos: ${Object.keys(ALLOWED).join(', ')}.` });
      if (file.size < 1) return json(400, { error: 'O arquivo está vazio.' });
      if (file.size > MAX_BYTES) return json(413, { error: `Arquivo maior que ${MAX_BYTES / 1048576} MB.` });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!ALLOWED[ext](bytes)) return json(400, { error: `O conteúdo não corresponde a um arquivo .${ext} válido.` });
      const path = `${actor.id}/${newId()}.${ext}`, mime = MIME[ext] ?? 'text/plain';
      await storage.upload(path, bytes, mime);
      try { const id = await db.register(actor.id, exercise, name, mime, bytes.length, path); return json(200, { id, name, size: bytes.length }); }
      catch (e) { await storage.remove([path]).catch(() => {}); throw e; }
    }
    let body; try { body = await req.json(); } catch { return json(400, { error: 'Corpo inválido.' }); }
    switch (body?.action) {
      case 'check-link': {
        const uid = await db.linkBegin(body.token);
        const r = await validateLink(body.url, { fetchImpl, unzip });
        await db.linkSave(uid, String(body.url ?? '').trim(), r);
        return json(200, r);
      }
      case 'delete-file': {
        const actor = await db.actor(body.token);
        const path = await db.deletePending(actor.id, body.file_id);
        if (path) await storage.remove([path]);
        return json(200, { deleted: Boolean(path) });
      }
      case 'file-url': {
        const f = await db.access(body.token, body.file_id);
        return json(200, { name: f.name, url: await storage.signedUrl(f.path, 300) });
      }
      default: return json(400, { error: 'Ação desconhecida.' });
    }
  } catch (e) { return fail(e); }
}
