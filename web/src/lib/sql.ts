// Utilitários do Editor SQL (sem dependências): dividir um script em instruções e exportar resultados.

export interface Stmt { text: string; start: number; from: number; end: number }   // [start, end) no texto original, sem o ";"; from = 1º caractere não branco

/** Remove comentários (-- e /* *\/) fora de textos entre aspas. */
export function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i], d = src[i + 1];
    if (c === '-' && d === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = skipBlock(src, i); out += ' '; continue; }
    if (c === "'" || c === '"') { const e = skipQuoted(src, i); out += src.slice(i, e); i = e; continue; }
    out += c; i++;
  }
  return out;
}

function skipBlock(s: string, i: number): number {          // comentários de bloco aninham no Postgres
  let depth = 1; i += 2;
  while (i < s.length && depth > 0) {
    if (s[i] === '/' && s[i + 1] === '*') { depth++; i += 2; }
    else if (s[i] === '*' && s[i + 1] === '/') { depth--; i += 2; }
    else i++;
  }
  return i;
}
function skipQuoted(s: string, i: number): number {         // 'texto' ou "identificador"; aspas dobradas escapam
  const q = s[i]; i++;
  while (i < s.length) {
    if (s[i] === q) { if (s[i + 1] === q) { i += 2; continue; } return i + 1; }
    i++;
  }
  return i;
}

/** Divide o script em instruções pelo ";" (ignora ";" em textos, identificadores e comentários). */
export function splitStatements(src: string): Stmt[] {
  const out: Stmt[] = [];
  let start = 0;
  const push = (end: number) => {
    const raw = src.slice(start, end);
    if (stripComments(raw).trim() !== '') out.push({ text: raw.trim(), start, from: start + raw.length - raw.trimStart().length, end });
  };
  for (let i = 0; i < src.length;) {
    const c = src[i], d = src[i + 1];
    if (c === '-' && d === '-') { while (i < src.length && src[i] !== '\n') i++; }
    else if (c === '/' && d === '*') i = skipBlock(src, i);
    else if (c === "'" || c === '"') i = skipQuoted(src, i);
    else if (c === ';') { push(i); i++; start = i; }
    else i++;
  }
  push(src.length);
  return out;
}

/** Texto a executar: a seleção, se houver; senão a instrução onde está o cursor. */
export function pickStatement(src: string, selStart: number, selEnd: number): string {
  if (selEnd > selStart) return src.slice(selStart, selEnd).trim();
  const all = splitStatements(src);
  if (all.length === 0) return '';
  const idx = all.findIndex((s) => selStart >= s.start && selStart <= s.end);
  if (idx >= 0) {
    // Cursor em branco antes do começo da instrução (ex.: logo após o ";" ou em linha vazia) → a anterior.
    const prev = all[idx - 1];
    if (prev && selStart < all[idx].from) return prev.text;
    return all[idx].text;
  }
  const before = [...all].reverse().find((s) => s.end <= selStart);   // cursor em espaço/comentário após um ";"
  return (before ?? all[0]).text;
}

/** CSV compatível com Excel pt-BR (separador ";" e BOM UTF-8). */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    const t = typeof v === 'number' ? s.replace('.', ',') : s;
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [columns.map(cell).join(';'), ...rows.map((r) => columns.map((c) => cell(r[c])).join(';'))].join('\r\n');
}
