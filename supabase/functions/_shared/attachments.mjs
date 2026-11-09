// Leitura dos arquivos/links entregues pelo aluno, para a PRÉ-análise da IA.
// Segurança (SSRF): só https, só hospedagens permitidas (GitHub, Google Drive/Docs, OneDrive), redirecionamentos revalidados
// a cada salto, sem IP literal, tempo e tamanho limitados. O conteúdo lido é tratado como dado não confiável.
//
// Formatos: .xlsx/.xlsm (abas, valores, FÓRMULAS, tabelas dinâmicas, gráficos) · .pbit (tabelas, medidas DAX, relacionamentos, páginas/visuais)
//           .pbix (páginas e visuais; o modelo/DAX é binário e NÃO é legível) · .ipynb/.py/.sql/.dax/.csv/.txt/.md (texto)
//           .pptx/.docx (texto) · PDF e imagens (enviados ao Gemini como visão)
// Não executa nada: código Python/SQL é lido, nunca rodado.

const HOSTS = ['github.com', 'raw.githubusercontent.com', 'gist.githubusercontent.com', 'drive.google.com', 'docs.google.com', 'drive.usercontent.google.com',
  'googleusercontent.com', '1drv.ms', 'onedrive.live.com', 'api.onedrive.com', 'sharepoint.com', 'files.1drv.com', 'microsoftpersonalcontent.com'];
export const MAX_BYTES = 8 * 1024 * 1024;
const LOGIN_HOSTS = ['accounts.google.com', 'login.live.com', 'login.microsoftonline.com', 'github.com/login'];
const MAX_TEXT = 24000, MAX_FILES = 3, MAX_INLINE = 4 * 1024 * 1024;

export function hostAllowed(host) {
  const h = String(host).toLowerCase();
  if (/^[\d.]+$/.test(h) || h.includes(':') || h.includes('[')) return false;       // IP literal
  return HOSTS.some((d) => h === d || h.endsWith('.' + d));
}
const parseHttps = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && hostAllowed(x.hostname) ? x : null; } catch { return null; } };

/** URLs da entrega (campo link + links dentro do texto), únicas, só as permitidas. */
export function extractUrls(sub) {
  const found = [sub.link_url, ...(String(sub.content ?? '').match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])].filter(Boolean)
    .map((u) => u.replace(/[.,;:!?]+$/, ''));
  const out = [], skipped = [];
  for (const u of new Set(found)) (parseHttps(u) ? out : skipped).push(u);
  return { urls: out.slice(0, MAX_FILES), skipped: skipped.slice(0, 5) };
}

/** Converte links de compartilhamento em links de download/exportação. */
export function toDownloadUrl(raw) {
  const u = parseHttps(raw); if (!u) return null;
  const p = u.pathname;
  if (u.hostname === 'github.com') {
    let m = p.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/); if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    m = p.match(/^\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+))?\/?$/); if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3] ?? 'HEAD'}/README.md`;
  }
  if (u.hostname === 'drive.google.com') { const m = p.match(/\/file\/d\/([\w-]+)/) ?? [null, u.searchParams.get('id')]; if (m[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`; }
  if (u.hostname === 'docs.google.com') {
    const m = p.match(/^\/(spreadsheets|document|presentation)\/d\/([\w-]+)/);
    if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=${{ spreadsheets: 'xlsx', document: 'pdf', presentation: 'pptx' }[m[1]]}`;
  }
  if (u.hostname === '1drv.ms' || u.hostname === 'onedrive.live.com' || u.hostname.endsWith('.sharepoint.com')) {
    const b64 = btoa(u.href).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    return `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`;
  }
  return u.href;
}

/** Baixa com limites: redirecionamentos manuais revalidados, timeout e teto de bytes. */
export async function fetchLimited(url, { fetchImpl = fetch, maxBytes = MAX_BYTES, timeoutMs = 20000 } = {}) {
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!parseHttps(cur)) return { ok: false, reason: 'host não permitido' };
    let res;
    try { res = await fetchImpl(cur, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'DAFA-grader/1.0' } }); }
    catch { return { ok: false, reason: 'não foi possível baixar (rede/tempo)' }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      cur = new URL(res.headers.get('location'), cur).href;
      if (LOGIN_HOSTS.some((d) => new URL(cur).hostname === d)) return { ok: false, reason: 'link privado: pede login' };
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, reason: `link privado ou inexistente (HTTP ${res.status})` };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const len = Number(res.headers.get('content-length'));
    if (len > maxBytes) return { ok: false, tooBig: true, reason: `arquivo maior que ${Math.round(maxBytes / 1048576)} MB` };
    const chunks = []; let n = 0;
    const rd = res.body?.getReader?.();
    if (rd) { for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > maxBytes) { await rd.cancel(); return { ok: false, tooBig: true, reason: `arquivo maior que ${Math.round(maxBytes / 1048576)} MB` }; } chunks.push(value); } }
    else { const b = new Uint8Array(await res.arrayBuffer()); if (b.length > maxBytes) return { ok: false, reason: 'arquivo grande demais' }; chunks.push(b); n = b.length; }
    const bytes = new Uint8Array(n); let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
    const cd = res.headers.get('content-disposition') ?? '';
    return { ok: true, bytes, finalUrl: cur, contentType: res.headers.get('content-type') ?? '', filename: decodeURIComponent((cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) ?? [])[1] ?? '') || cur.split('?')[0].split('/').pop() };
  }
  return { ok: false, reason: 'redirecionamentos demais' };
}

// ───────── extratores ─────────
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (s, n) => (s.match(new RegExp(`\\b${n}="([^"]*)"`)) ?? [])[1];
const textsOf = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => unesc(m[1]));
const clipText = (t, n = MAX_TEXT) => (t.length > n ? { text: t.slice(0, n) + `\n[… truncado: ${t.length - n} caracteres omitidos]`, truncated: true } : { text: t, truncated: false });
const utf16 = (u8) => new TextDecoder('utf-16le').decode(u8).replace(/^﻿/, '');
const colN = (ref) => ref.replace(/\d+/g, '').split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const rowN = (ref) => Number(ref.replace(/\D+/g, ''));

export function extractXlsx(files, str) {
  const get = (p) => (files[p] ? str(files[p]) : '');
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textsOf(m[1], 't').join(''));
  const rels = Object.fromEntries([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const L = [];
  for (const m of get('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(attr(m[0], 'name') ?? '?'); let t = rels[attr(m[0], 'r:id')] ?? '';
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t; const xml = get(t);
    const cells = [...xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
    let nForm = 0; const rows = new Map(), forms = [];
    for (const c of cells) {
      const ref = attr(c[1], 'r'); if (!ref || !c[2]) continue;
      const type = attr(c[1], 't'); const f = (c[2].match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/) ?? [])[1]; const v = (c[2].match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
      let val = v ?? ''; if (type === 's') val = shared[Number(v)] ?? ''; else if (type === 'inlineStr') val = textsOf(c[2], 't').join(''); else if (type === 'b') val = v === '1' ? 'VERDADEIRO' : 'FALSO';
      if (f) { nForm++; if (forms.length < 15) forms.push(`${ref}: =${unesc(f)} → ${unesc(val)}`); }
      if (val === '' && !f) continue;
      const r = rowN(ref); if (r > 40 || colN(ref) > 12) continue;
      if (!rows.has(r)) rows.set(r, []); rows.get(r).push(`${ref}=${unesc(val).slice(0, 60)}${f ? ' ƒ' : ''}`);
    }
    L.push(`### Aba "${name}" — ${cells.filter((c) => c[2]).length} células preenchidas, ${nForm} com fórmula`);
    if (forms.length) L.push('Fórmulas (amostra):', ...forms);
    L.push('Primeiras linhas (A–L, até a linha 40):', ...[...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.join(' | ')));
  }
  const names = (re, fn) => Object.keys(files).filter((k) => re.test(k)).sort().map((k) => fn(str(files[k])));
  const piv = names(/^xl\/pivotTables\/pivotTable\d+\.xml$/, (x) => `tabela dinâmica "${attr(x.match(/<pivotTableDefinition\b[^>]*>/)?.[0] ?? '', 'name')}" em ${attr(x.match(/<location\b[^>]*>/)?.[0] ?? '', 'ref')}`);
  const tbl = names(/^xl\/tables\/table\d+\.xml$/, (x) => `Tabela "${attr(x.match(/<table\b[^>]*>/)?.[0] ?? '', 'displayName')}" (${attr(x.match(/<table\b[^>]*>/)?.[0] ?? '', 'ref')})`);
  const ch = names(/^xl\/charts\/chart\d+\.xml$/, (x) => `gráfico ${(x.match(/<c:(bar|line|pie|area|scatter|doughnut|radar|bubble)Chart\b/) ?? [, '?'])[1]} — título: "${textsOf(x.match(/<c:title>[\s\S]*?<\/c:title>/)?.[0] ?? '', 'a:t').join(' ') || '(sem título)'}"`);
  if (piv.length + tbl.length + ch.length) L.push('### Objetos', ...piv, ...tbl, ...ch);
  else L.push('### Objetos: nenhuma tabela dinâmica, Tabela do Excel ou gráfico encontrado.');
  return L.join('\n');
}

export function extractPowerBi(files, str) {
  const L = []; const parse = (k) => { try { return JSON.parse(utf16(files[k])); } catch { return null; } };
  const schema = files.DataModelSchema ? parse('DataModelSchema') : null;
  if (schema?.model) {
    L.push('### Modelo de dados (DataModelSchema)');
    for (const t of schema.model.tables ?? []) {
      L.push(`Tabela ${t.name}: colunas ${(t.columns ?? []).map((c) => c.name).join(', ').slice(0, 300)}`);
      for (const m of t.measures ?? []) L.push(`  Medida [${m.name}] = ${[].concat(m.expression ?? '').join(' ').replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    for (const r of schema.model.relationships ?? []) L.push(`Relacionamento: ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]${r.crossFilteringBehavior ? ` (${r.crossFilteringBehavior})` : ''}${r.isActive === false ? ' (inativo)' : ''}`);
  } else L.push('### Modelo de dados: NÃO legível (.pbix guarda o modelo e o DAX em formato binário). Peça ao aluno para colar as medidas DAX ou exportar como .pbit.');
  const lay = files['Report/Layout'] ? parse('Report/Layout') : null;
  if (lay) {
    L.push('### Páginas e visuais (Report/Layout)');
    for (const s of lay.sections ?? []) {
      const vs = (s.visualContainers ?? []).map((vc) => { try { const c = JSON.parse(vc.config).singleVisual; if (!c) return null;
        const title = c.vcObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value?.replace(/^'|'$/g, '');
        const fields = Object.values(c.projections ?? {}).flat().map((p) => p.queryRef).slice(0, 6).join(', ');
        return `${c.visualType}${title ? ` "${title}"` : ''}${fields ? ` [${fields}]` : ''}`; } catch { return null; } }).filter(Boolean);
      L.push(`Página "${s.displayName}": ${vs.length} visuais — ${vs.join('; ')}`);
    }
  }
  return L.join('\n');
}

export function extractNotebook(json) {
  let nb; try { nb = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(nb?.cells)) return null;
  const L = [];
  nb.cells.forEach((c, i) => {
    const src = [].concat(c.source ?? []).join('');
    if (c.cell_type === 'markdown') L.push(`[md ${i}] ${src.slice(0, 600)}`);
    else if (c.cell_type === 'code') {
      L.push(`[código ${i}]\n${src.slice(0, 1500)}`);
      for (const o of c.outputs ?? []) {
        const t = [].concat(o.text ?? o.data?.['text/plain'] ?? []).join('').slice(0, 500);
        if (t) L.push(`[saída ${i}] ${t}`); if (o.data?.['image/png']) L.push(`[saída ${i}] (imagem de gráfico)`);
        if (o.output_type === 'error') L.push(`[saída ${i}] ERRO: ${o.ename}: ${o.evalue}`);
      }
    }
  });
  return L.join('\n');
}

const IMG = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif'
  : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 ? 'image/webp' : null);

/** Interpreta os bytes baixados → {kind, text?, inline?{mimeType,data}} ou {error}. */
export function interpret(bytes, { unzip, name = '' }) {
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return bytes.length > MAX_INLINE ? { error: 'PDF grande demais para a pré-análise' } : { kind: 'pdf', inline: { mimeType: 'application/pdf', data: b64(bytes) } };
  }
  const img = IMG(bytes);
  if (img) return bytes.length > MAX_INLINE ? { error: 'imagem grande demais' } : { kind: 'imagem', inline: { mimeType: img, data: b64(bytes) } };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (!unzip) return { error: 'leitor de arquivos compactados indisponível' };
    let files; try { files = unzip.unzipSync(bytes, { filter: (f) => f.originalSize < 20 * 1024 * 1024 && /^(xl\/|ppt\/slides\/|word\/document|DataModelSchema|Report\/Layout|\[Content_Types\])/.test(f.name) }); } catch { return { error: 'arquivo compactado inválido' }; }
    const str = unzip.strFromU8, keys = Object.keys(files);
    if (keys.some((k) => k.startsWith('xl/'))) return { kind: 'excel', ...clipText(extractXlsx(files, str)) };
    if (files.DataModelSchema || files['Report/Layout']) return { kind: files.DataModelSchema ? 'power bi (.pbit)' : 'power bi (.pbix, só layout)', ...clipText(extractPowerBi(files, str)) };
    const slides = keys.filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, c) => Number(a.match(/\d+/)) - Number(c.match(/\d+/)));
    if (slides.length) return { kind: 'pptx', ...clipText(slides.map((k, i) => `Slide ${i + 1}: ${textsOf(str(files[k]), 'a:t').join(' ')}`).join('\n')) };
    if (files['word/document.xml']) return { kind: 'docx', ...clipText(textsOf(str(files['word/document.xml']), 'w:t').join(' ')) };
    return { error: 'tipo de arquivo compactado não suportado' };
  }
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { error: 'formato binário não suportado' }; }
  if (/^\s*<(!doctype|html)/i.test(text)) return { error: 'o link abriu uma página de login/visualização, não o arquivo (deixe como "qualquer pessoa com o link")' };
  const nb = /^\s*\{/.test(text) ? extractNotebook(text) : null;
  if (nb != null) return { kind: 'notebook', ...clipText(nb) };
  const ext = (name.match(/\.(\w+)$/) ?? [, 'txt'])[1].toLowerCase();
  return { kind: ['py', 'sql', 'dax', 'csv', 'md'].includes(ext) ? ext : 'texto', ...clipText(text) };
}

/**
 * Valida um link ANTES de aceitar a entrega: https, hospedagem suportada, acessível sem login.
 * Retorna { ok, kind?, detail?, warning? }. "ok" = acessível publicamente (mesmo que a IA não consiga ler o formato).
 */
export async function validateLink(raw, deps = {}) {
  const url = String(raw ?? '').trim();
  const HELP = 'Compartilhe como “qualquer pessoa com o link” e tente de novo.';
  let u; try { u = new URL(url); } catch { return { ok: false, detail: 'Link inválido. Cole o endereço completo, começando com https://.' }; }
  if (u.protocol !== 'https:') return { ok: false, detail: 'Use um link https://.' };
  if (!hostAllowed(u.hostname)) return { ok: false, detail: 'Hospedagem não suportada. Use GitHub, Google Drive/Docs/Planilhas/Apresentações ou OneDrive/SharePoint.' };
  const folder = u.hostname === 'drive.google.com' && /^\/drive\/(u\/\d+\/)?folders\//.test(u.pathname);
  const dl = folder ? u.href : toDownloadUrl(url);
  if (!dl) return { ok: false, detail: 'Link não reconhecido.' };
  const got = await fetchLimited(dl, { fetchImpl: deps.fetchImpl });
  if (!got.ok) {
    if (got.tooBig) return { ok: true, kind: 'arquivo grande', warning: `Link acessível, mas ${got.reason}: a IA não fará a pré-análise; o tutor verá o arquivo.` };
    return { ok: false, detail: `Não consegui acessar o link (${got.reason}). ${HELP}` };
  }
  if (folder) return { ok: true, kind: 'pasta', warning: 'Pasta pública: a IA não lê o conteúdo da pasta; o tutor abrirá os arquivos.' };
  const r = interpret(got.bytes, { unzip: deps.unzip, name: got.filename });
  if (r.error && /login/.test(r.error)) return { ok: false, detail: `O link abre uma página de login/visualização, não o arquivo. ${HELP}` };
  if (r.error) return { ok: true, kind: 'arquivo', warning: `Link acessível, mas ${r.error}: a IA não fará a pré-análise; o tutor verá o arquivo.` };
  return { ok: true, kind: r.kind, warning: /só layout/.test(r.kind) ? 'Power BI .pbix: a IA lê só páginas e visuais. Para conferir o DAX, envie .pbit ou cole as medidas no texto.' : undefined };
}

/**
 * Lê o que o aluno entregou: arquivos ANEXADOS (guardados no Storage) e links públicos.
 * Retorna { files:[{name,kind,text?,inline?,note}], report:[{source,status,kind?,detail?,origin}], read:n }.
 * sub.files: [{name, path}] · deps: { fetchImpl, unzip:{unzipSync,strFromU8}, readFile(path) → Uint8Array }
 */
export async function collectAttachments(sub, deps = {}) {
  const files = [], report = [];
  let inline = 0;
  const add = (source, name, bytes, origin) => {
    const r = interpret(bytes, { unzip: deps.unzip, name });
    if (r.error) { report.push({ source: String(source).slice(0, 200), status: 'failed', detail: r.error, origin }); return; }
    if (r.inline) { inline += bytes.length; if (inline > MAX_INLINE * 2) { report.push({ source: String(source).slice(0, 200), status: 'failed', detail: 'limite de anexos visuais', origin }); return; } }
    files.push({ name: name || String(source), kind: r.kind, text: r.text, inline: r.inline, truncated: r.truncated });
    report.push({ source: String(source).slice(0, 200), status: 'read', kind: r.kind, name, bytes: bytes.length, truncated: Boolean(r.truncated), origin });
  };
  for (const f of (sub.files ?? []).slice(0, 5)) {
    try { add(f.name, f.name, await deps.readFile(f.path), 'upload'); }
    catch { report.push({ source: f.name, status: 'failed', detail: 'não foi possível ler o arquivo anexado', origin: 'upload' }); }
  }
  const { urls, skipped } = extractUrls(sub);
  for (const s of skipped) report.push({ source: s.slice(0, 200), status: 'ignored', detail: 'hospedagem não suportada (use GitHub, Google Drive/Docs ou OneDrive)', origin: 'link' });
  for (const u of urls) {
    const dl = toDownloadUrl(u);
    const got = dl ? await fetchLimited(dl, { fetchImpl: deps.fetchImpl }) : { ok: false, reason: 'link inválido' };
    if (!got.ok) { report.push({ source: u.slice(0, 200), status: 'failed', detail: got.reason, origin: 'link' }); continue; }
    add(u, got.filename, got.bytes, 'link');
  }
  return { files, report, read: files.length };
}
