import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { pickStatement, toCsv } from '../lib/sql';
import { ErrorBox, Spinner } from '../components/ui';

interface TableInfo { table: string; columns: { name: string; type: string }[] }
interface RunOk { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean; limit: number; ms: number }
interface RunErr { error: string }
type Result = ({ kind: 'ok'; sql: string } & RunOk) | { kind: 'error'; sql: string; message: string };

const DRAFT_KEY = 'dafa.sql.draft';
const STARTER = `-- Ctrl+Enter (ou ⌘+Enter) executa a consulta onde está o cursor, ou só o trecho selecionado.
SELECT status, COUNT(*) AS pedidos
FROM treinamento.fato_pedidos
GROUP BY status
ORDER BY pedidos DESC;
`;
const readDraft = () => { try { return localStorage.getItem(DRAFT_KEY) ?? STARTER; } catch { return STARTER; } };
const saveDraft = (v: string) => { try { localStorage.setItem(DRAFT_KEY, v); } catch { /* armazenamento indisponível */ } };

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export default function SqlEditor() {
  const { token, signOut } = useAuth();
  const { data } = useData();
  const [sql, setSql] = useState(readDraft);
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [schema, setSchema] = useState<TableInfo[] | null>(null);
  const [schemaErr, setSchemaErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [tpl, setTpl] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);

  const guard = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Sessão (inválida|expirada)/.test(msg)) void signOut();
    return msg;
  }, [signOut]);

  useEffect(() => {
    api<TableInfo[]>('app_sql_schema', { p_token: token }).then(setSchema).catch((e) => setSchemaErr(guard(e)));
  }, [token, guard]);
  useEffect(() => { const t = setTimeout(() => saveDraft(sql), 400); return () => clearTimeout(t); }, [sql]);

  const run = useCallback(async () => {
    const el = ta.current;
    const stmt = el ? pickStatement(el.value, el.selectionStart, el.selectionEnd) : sql.trim();
    if (!stmt) { setResult({ kind: 'error', sql: '', message: 'Escreva uma consulta e clique em Executar.' }); return; }
    setRunning(true);
    try {
      const r = await api<RunOk | RunErr>('app_run_sql', { p_token: token, p_sql: stmt });
      setResult('error' in r ? { kind: 'error', sql: stmt, message: r.error } : { kind: 'ok', sql: stmt, ...r });
    } catch (e) {
      setResult({ kind: 'error', sql: stmt, message: guard(e) });
    } finally { setRunning(false); }
  }, [sql, token, guard]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run(); return; }
    if (e.key === 'Tab' && !e.shiftKey) {                                   // Tab insere 2 espaços (Esc+Tab sai do campo no teclado)
      e.preventDefault();
      const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd;
      setSql(el.value.slice(0, a) + '  ' + el.value.slice(b));
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
    }
  };

  const insert = (text: string) => {
    const el = ta.current;
    const a = el?.selectionStart ?? sql.length, b = el?.selectionEnd ?? sql.length;
    setSql(sql.slice(0, a) + text + sql.slice(b));
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = a + text.length; } });
  };
  const previewTable = (t: string) => {
    const q = `SELECT * FROM treinamento.${t} LIMIT 20;`;
    setSql((cur) => (cur.trim() ? cur.replace(/\s*$/, '\n\n') + q + '\n' : q + '\n'));
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = Math.max(0, el.value.length - 2); } });   // cursor dentro da nova consulta
  };

  const sqlTemplates = useMemo(() => data.templates.filter((t) => t.kind === 'sql' && t.content), [data.templates]);
  const loadTemplate = (slug: string) => {
    setTpl(slug);
    const t = sqlTemplates.find((x) => x.slug === slug);
    if (!t?.content) return;
    if (sql.trim() && sql.trim() !== STARTER.trim() && !window.confirm('Substituir o conteúdo do editor pelo template?')) { setTpl(''); return; }
    setSql(t.content.endsWith('\n') ? t.content : t.content + '\n');
    setResult(null);
  };

  const download = () => {
    if (result?.kind !== 'ok') return;
    const blob = new Blob([toCsv(result.columns, result.rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'resultado.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const visible = useMemo(() => (schema ?? []).filter((t) => t.table.toLowerCase().includes(filter.toLowerCase())), [schema, filter]);
  const numeric = useMemo(() => {
    if (result?.kind !== 'ok') return new Set<string>();
    return new Set(result.columns.filter((c) => result.rows.length > 0 && result.rows.every((r) => r[c] === null || typeof r[c] === 'number')));
  }, [result]);

  return (
    <div className="stack">
      <div>
        <h1>🧮 Editor SQL</h1>
        <p className="muted" style={{ margin: 0 }}>Consulte o schema <code>treinamento</code> (dados fictícios) direto no navegador, sem instalar nada e sem conta no Supabase. Somente leitura.</p>
      </div>

      <div className="sqlgrid">
        <aside className="card flat sqlside" aria-label="Tabelas do banco">
          <div className="row between" style={{ marginBottom: 8 }}><b>Tabelas</b><span className="muted small">{schema ? `${schema.length}` : ''}</span></div>
          <input type="text" placeholder="Filtrar tabelas…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar tabelas" />
          {!schema && !schemaErr && <Spinner />}
          {schemaErr && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>Não foi possível listar as tabelas: {schemaErr}</div>}
          <ul className="sqltables">
            {visible.map((t) => (
              <li key={t.table}>
                <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <button className="linklike" onClick={() => setOpen(open === t.table ? null : t.table)} aria-expanded={open === t.table} title="Ver colunas">{open === t.table ? '▾' : '▸'}</button>
                  <button className="linklike name" onClick={() => insert(t.table)} title="Inserir o nome no editor"><code>{t.table}</code></button>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => previewTable(t.table)} title="Adicionar SELECT * … LIMIT 20">👁</button>
                </div>
                {open === t.table && (
                  <ul className="sqlcols">
                    {t.columns.map((c) => (
                      <li key={c.name}><button className="linklike" onClick={() => insert(c.name)} title="Inserir o nome da coluna"><code>{c.name}</code></button> <span className="muted small">{c.type}</span></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {schema && visible.length === 0 && <li className="muted small">Nenhuma tabela encontrada.</li>}
          </ul>
        </aside>

        <section className="stack" style={{ minWidth: 0 }}>
          <div className="card flat">
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="btn primary" onClick={() => void run()} disabled={running}>{running ? 'Executando…' : '▶ Executar'}</button>
              <span className="muted small">Ctrl/⌘ + Enter · executa o trecho selecionado ou a consulta sob o cursor</span>
              <select value={tpl} onChange={(e) => loadTemplate(e.target.value)} style={{ maxWidth: 280, marginLeft: 'auto' }} aria-label="Carregar template SQL">
                <option value="">📄 Carregar template…</option>
                {sqlTemplates.map((t) => <option key={t.slug} value={t.slug}>{t.title}</option>)}
              </select>
              <button className="btn sm" onClick={() => { if (window.confirm('Limpar o editor?')) { setSql(''); setResult(null); } }}>Limpar</button>
            </div>
            <textarea ref={ta} className="sqlarea" value={sql} onChange={(e) => setSql(e.target.value)} onKeyDown={onKey}
              spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="Editor SQL" placeholder="Escreva sua consulta SQL aqui…" />
            <div className="muted small" style={{ marginTop: 6 }}>
              Dica: use <code>AS</code> para dar nome às colunas (colunas com o mesmo nome se sobrepõem) e <code>LIMIT</code> para consultas grandes. O resultado mostra até 500 linhas.
            </div>
          </div>

          {result?.kind === 'error' && <ErrorBox msg={result.message} />}
          {result?.kind === 'ok' && (
            <div className="card flat">
              <div className="row between" style={{ marginBottom: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b>Resultado</b>
                  <span className="badge green">{result.rows.length} {result.rows.length === 1 ? 'linha' : 'linhas'}</span>
                  <span className="badge">{result.ms} ms</span>
                  {result.truncated && <span className="badge amber">mostrando as primeiras {result.limit}</span>}
                </div>
                <button className="btn sm" onClick={download} disabled={result.rows.length === 0}>⬇ CSV</button>
              </div>
              {result.rows.length === 0
                ? <div className="muted">A consulta rodou, mas não retornou linhas.</div>
                : (
                  <div className="sqlresult" tabIndex={0} aria-label="Resultado da consulta">
                    <table>
                      <thead><tr>{result.columns.map((c) => <th key={c} className={numeric.has(c) ? 'num' : ''}>{c}</th>)}</tr></thead>
                      <tbody>
                        {result.rows.map((r, i) => (
                          <tr key={i}>{result.columns.map((c) => {
                            const v = r[c];
                            return <td key={c} className={numeric.has(c) ? 'num' : ''}>{v === null ? <span className="muted">NULL</span> : fmt(v)}</td>;
                          })}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              <details style={{ marginTop: 10 }}><summary className="muted small">Consulta executada</summary><pre className="code">{result.sql}</pre></details>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
