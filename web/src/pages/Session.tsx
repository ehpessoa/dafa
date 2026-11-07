import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, checkLink, deleteFile, fileUrl, uploadFile, type LinkResult } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { fmtDate, weekday, isWaiting, type ExState } from '../lib/progress';
import type { Exercise } from '../lib/types';
import { ExBadge, Empty, SessBadge } from '../components/ui';
import TemplateCard from '../components/TemplateCard';
import ResourceCard from '../components/ResourceCard';

const ACCEPT = '.xlsx,.xlsm,.pptx,.docx,.pbix,.pbit,.pdf,.png,.jpg,.jpeg,.gif,.webp,.py,.sql,.dax,.csv,.txt,.md,.ipynb,.json';
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Link para baixar um arquivo anexado (URL assinada, válida por 5 min). */
function FileLink({ id, name, size }: { id: string; name: string; size: number }) {
  const { token } = useAuth();
  const [err, setErr] = useState('');
  const open = async () => { setErr(''); try { window.open((await fileUrl(token ?? '', id)).url, '_blank', 'noopener'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return <span><button type="button" className="btn sm" onClick={open}>📎 {name} <span className="muted">({fmtSize(size)})</span></button>{err && <span className="small" style={{ color: 'var(--red)' }}> {err}</span>}</span>;
}
export { FileLink };

const TABS = [
  ['conceito', '1 · Conceito'], ['ferramentas', '2 · Ferramentas'], ['exercicios', '3 · Exercícios'], ['templates', '4 · Templates'], ['recursos', '5 · Recursos'],
] as const;

function ExerciseBlock({ ex, studentId, canSubmit }: { ex: Exercise; studentId: string; canSubmit: boolean }) {
  const { data, progress, reload } = useData();
  const { token } = useAuth();
  const [content, setContent] = useState('');
  const [link, setLink] = useState('');
  const [lc, setLc] = useState<{ state: 'idle' | 'checking' | 'ok' | 'bad'; res?: LinkResult }>({ state: 'idle' });
  const [files, setFiles] = useState<{ id: string; name: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileErr, setFileErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const state: ExState = progress.exState(studentId, ex.id);
  const attempts = progress.attempts(studentId, ex.id);
  const waiting = attempts.length > 0 && isWaiting(attempts[attempts.length - 1]); // último envio ainda sem decisão (IA ou tutor)
  const rejected = state === 'rejected';

  const validate = async () => {
    const u = link.trim(); if (!u) return;
    setLc({ state: 'checking' });
    try { const r = await checkLink(token ?? '', u); setLc({ state: r.ok ? 'ok' : 'bad', res: r }); }
    catch (e) { setLc({ state: 'bad', res: { ok: false, detail: e instanceof Error ? e.message : String(e) } }); }
  };
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true); setFileErr('');
    for (const f of Array.from(list)) {
      try { const r = await uploadFile(token ?? '', ex.id, f); setFiles((x) => [...x, r]); }
      catch (e) { setFileErr(`${f.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    setUploading(false);
  };
  const removeFile = async (id: string) => { try { await deleteFile(token ?? '', id); } catch { /* já removido */ } setFiles((x) => x.filter((f) => f.id !== id)); };
  const linkPending = Boolean(link.trim()) && lc.state !== 'ok';          // link informado precisa estar validado
  const canSend = !busy && !uploading && !linkPending && Boolean(content.trim() || link.trim() || files.length);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api('app_submit', { p_token: token, p_exercise_id: ex.id, p_content: content.trim() || null, p_link: link.trim() || null, p_file_ids: files.length ? files.map((f) => f.id) : null });
      setContent(''); setLink(''); setFiles([]); setLc({ state: 'idle' }); await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="card stack">
      <div className="row between"><h3 style={{ margin: 0 }}>{ex.position}. {ex.title}</h3><ExBadge s={state} /></div>
      <div>{ex.instructions}</div>
      <div className="small"><b>📎 Entregável:</b> {ex.deliverable}</div>

      {attempts.length > 0 && (
        <div>
          <b className="small muted">Histórico de tentativas</b>
          {[...attempts].reverse().map((a) => {
            const rev = progress.reviewOf(a.id);
            return (
              <div key={a.id} className={`attempt ${a.status}`}>
                <div className="row between"><b>Tentativa {a.attempt}</b><span className="small muted">{fmtDate(a.created_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
                {a.content && <div style={{ whiteSpace: 'pre-wrap' }}>{a.content}</div>}
                {a.link_url && <div><a href={a.link_url} target="_blank" rel="noreferrer noopener">🔗 {a.link_url}</a> {a.link_check?.ok && <span className="badge green" title={a.link_check.warning ?? ''}>acesso verificado</span>}</div>}
                {data.files.filter((f) => f.submission_id === a.id).length > 0 && <div className="row" style={{ marginTop: 4 }}>{data.files.filter((f) => f.submission_id === a.id).map((f) => <FileLink key={f.id} id={f.id} name={f.name} size={f.size_bytes} />)}</div>}
                {rev ? (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                    <div className="row between">
                      <span className="row" style={{ gap: 6 }}>
                        <span className={`badge ${rev.verdict === 'approved' ? 'green' : rev.verdict === 'rejected' ? 'red' : 'amber'}`}>
                          {rev.verdict === 'approved' ? '✔ Aprovado' : rev.verdict === 'rejected' ? '✖ Reprovado' : '↩ Refaça'}
                        </span>
                        <span className="badge">{rev.source === 'ai' ? '🤖 Correção automática' : '🎓 Tutor'}</span>
                      </span>
                      <span className="score">{rev.score.toFixed(1)}/10</span>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>💬 {rev.feedback}</div>
                    {rev.instructions && <div style={{ marginTop: 8 }}><b className="small">📋 Como refazer</b><div className="todo-box">{rev.instructions}</div></div>}
                    {rev.examples && <div style={{ marginTop: 8 }}><b className="small">💡 Exemplo</b><div className="example-box">{rev.examples}</div></div>}
                  </div>
                ) : a.status === 'needs_review'
                  ? <div className="small" style={{ marginTop: 6 }}>🔎 Passou pela correção automática e está <b>em revisão pelo tutor</b>. Você será avisado da decisão.</div>
                  : <div className="small muted" style={{ marginTop: 6 }}>⏳ Aguardando correção…</div>}
              </div>
            );
          })}
        </div>
      )}

      {canSubmit && rejected && <div className="alert err">✖ Esta entrega foi <b>reprovada</b> pelo tutor (veja o motivo acima). Fale com o tutor se quiser reabrir o exercício.</div>}
      {canSubmit && !waiting && !rejected && (
        <div>
          <b>{attempts.length === 0 ? 'Enviar entrega' : state === 'approved' ? 'Enviar nova versão (opcional)' : `Refazer entrega · tentativa ${attempts.length + 1}`}</b>
          <label htmlFor={`c-${ex.id}`}>Resposta / explicação</label>
          <textarea id={`c-${ex.id}`} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Descreva o que fez, cole a query, os resultados, suas conclusões…" />
          <label htmlFor={`f-${ex.id}`}>Anexar arquivos — opcional <span className="muted small">(até 5 · 8 MB cada · Excel, Power BI, notebook, .py/.sql, slides, PDF, imagens)</span></label>
          <input id={`f-${ex.id}`} type="file" multiple accept={ACCEPT} disabled={uploading || files.length >= 5} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          {uploading && <div className="small muted">Enviando arquivo…</div>}
          {fileErr && <div className="alert err" style={{ marginTop: 6 }}>{fileErr}</div>}
          {files.length > 0 && <div className="stack" style={{ gap: 6, marginTop: 6 }}>{files.map((f) => (
            <div key={f.id} className="row between attempt submitted" style={{ margin: 0 }}><span>📎 {f.name} <span className="muted small">({fmtSize(f.size)})</span></span><button type="button" className="btn sm" onClick={() => removeFile(f.id)} aria-label={`Remover ${f.name}`}>Remover</button></div>))}</div>}
          <label htmlFor={`l-${ex.id}`}>Ou informe um link público — opcional</label>
          <div className="small muted" style={{ marginBottom: 4 }}>GitHub, Google Drive/Docs ou OneDrive, compartilhado como “qualquer pessoa com o link”. O link é <b>verificado antes do envio</b>.</div>
          <div className="row">
            <input id={`l-${ex.id}`} type="url" style={{ flex: 1 }} value={link} onChange={(e) => { setLink(e.target.value); setLc({ state: 'idle' }); }} onBlur={() => { if (link.trim() && lc.state === 'idle') void validate(); }} placeholder="https://" />
            <button type="button" className="btn sm" disabled={!link.trim() || lc.state === 'checking'} onClick={validate}>{lc.state === 'checking' ? 'Verificando…' : 'Verificar link'}</button>
          </div>
          {lc.state === 'ok' && <div className="alert ok" style={{ marginTop: 6 }} role="status">✔ Link acessível{lc.res?.kind ? ` (${lc.res.kind})` : ''}.{lc.res?.warning && <div className="small">{lc.res.warning}</div>}</div>}
          {lc.state === 'bad' && <div className="alert err" style={{ marginTop: 6 }} role="alert">✖ {lc.res?.detail ?? 'Não foi possível acessar o link.'}</div>}
          {err && <div className="alert err" style={{ marginTop: 8 }}>{err}</div>}
          <div style={{ marginTop: 10 }}><button className="btn primary" disabled={!canSend} onClick={submit}>{busy ? 'Enviando…' : attempts.length ? '🔁 Reenviar' : '📤 Enviar para avaliação'}</button></div>
        </div>
      )}
      {canSubmit && waiting && <div className="alert">⏳ Entrega enviada. Ela será corrigida automaticamente; se a nota for menor que 7, o tutor revisa e decide (aprovar, pedir ajustes com instruções ou reprovar). Você receberá uma notificação.</div>}
    </div>
  );
}

export default function SessionPage() {
  const { day: dayParam } = useParams();
  const [qs, setQs] = useSearchParams();
  const { profile, isTeacher } = useAuth();
  const { data, progress } = useData();
  const day = Number(dayParam);
  const s = data.sessions.find((x) => x.day === day);
  const viewAs = isTeacher ? qs.get('aluno') : null;
  const studentId = viewAs ?? profile!.id;
  const studentName = viewAs ? data.profiles.find((p) => p.id === viewAs)?.full_name : null;
  const tab = (qs.get('tab') ?? 'conceito') as (typeof TABS)[number][0];
  const level = data.levels.find((l) => l.slug === s?.level_slug);
  const exs = useMemo(() => data.exercises.filter((e) => e.session_day === day), [data.exercises, day]);
  if (!s || !level) return <Empty>Sessão não encontrada. <Link to="/trilha">Voltar à trilha</Link></Empty>;

  const st = progress.sessState(studentId, day);
  const missing = progress.missingDeps(studentId, day);
  const preview = isTeacher && !viewAs;
  const locked = st === 'locked' && !isTeacher;
  const deps = progress.depsOf.get(day) ?? [];
  const tpls = data.sessionTemplates.filter((x) => x.session_day === day).sort((a, b) => a.position - b.position).map((x) => data.templates.find((t) => t.slug === x.template_slug)!).filter(Boolean);
  const ress = data.sessionResources.filter((x) => x.session_day === day).sort((a, b) => a.position - b.position).map((x) => data.resources.find((r) => r.slug === x.resource_slug)!).filter(Boolean);
  const weekly = data.weekly.find((w) => w.session_day === day);
  const setTab = (t: string) => { const n = new URLSearchParams(qs); n.set('tab', t); setQs(n, { replace: true }); };
  const keep = viewAs ? `?aluno=${viewAs}` : '';

  return (
    <div className="stack">
      <div className="small"><Link to="/trilha">← Trilha</Link></div>
      <div className="card" style={{ borderTop: `5px solid ${level.color ?? '#2563eb'}` }}>
        <div className="row between">
          <div>
            <div className="row small"><span className="badge" style={{ background: level.color ?? undefined, color: '#fff' }}>{level.emoji} {level.title}</span>
              <span className="muted">Dia {day}/30 · Semana {s.week} · {weekday(s.scheduled_date)} {fmtDate(s.scheduled_date)} · ⏱ {s.minutes} min</span></div>
            <h1 style={{ margin: '8px 0 0' }}>{s.title}</h1>
          </div>
          <SessBadge s={st} />
        </div>
        {viewAs && <div className="alert" style={{ marginTop: 12 }}>👁️ Visualizando como tutor: progresso de <b>{studentName}</b> (somente leitura).</div>}
        {preview && <div className="alert" style={{ marginTop: 12 }}>👁️ Pré-visualização do tutor — o envio de entregas é exclusivo de alunos.</div>}
        <div className="row small" style={{ marginTop: 12 }}>
          <b>Depende de:</b>
          {deps.length ? deps.map((d) => {
            const ds = data.sessions.find((x) => x.day === d)!;
            return <Link key={d} className="chip" to={`/sessao/${d}${keep}`}>{progress.isDone(studentId, d) ? '✅' : '🔒'} Dia {d} · {ds.title}</Link>;
          }) : <span className="muted">nenhuma (sessão inicial)</span>}
        </div>
      </div>

      {locked ? (
        <div className="card lock">
          <div style={{ fontSize: '3rem' }}>🔒</div>
          <h2>Sessão bloqueada</h2>
          <p className="muted">Conclua (com aprovação do tutor) as sessões abaixo para liberar este conteúdo:</p>
          <div className="chips" style={{ justifyContent: 'center' }}>
            {missing.map((d) => <Link key={d} className="btn" to={`/sessao/${d}`}>Dia {d} · {data.sessions.find((x) => x.day === d)?.title}</Link>)}
          </div>
        </div>
      ) : (
        <>
          {weekly && <div className="alert ok">📦 <b>Entregável semanal {weekly.week}:</b> {weekly.title} — {weekly.description} <span className="muted">(prazo {weekday(weekly.due_date)} {fmtDate(weekly.due_date)})</span></div>}
          <div className="tabs" role="tablist">
            {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span className="n">{label[0]}</span>{label.slice(4)}</button>)}
          </div>

          {tab === 'conceito' && (
            <div className="grid g2">
              <div className="card"><h2>🎯 Por que isso importa?</h2><p>{s.why}</p><h3>📚 O que você vai aprender</h3><ul>{s.learn.map((x) => <li key={x}>{x}</li>)}</ul></div>
              <div className="card"><h2>🏢 Onde usar (cenários)</h2>{s.scenarios.map((c) => <p key={c.text}><span className="area">{c.area}</span>{c.text}</p>)}</div>
            </div>
          )}
          {tab === 'ferramentas' && (
            <div className="grid g2">
              <div className="card"><h2>🧰 Ferramentas da sessão</h2><div className="chips">{s.tools.map((t) => <span key={t} className="pill">{t}</span>)}</div></div>
              <div className="card"><h2>🔗 Como o conceito se conecta às ferramentas</h2><p>{s.connection}</p></div>
            </div>
          )}
          {tab === 'exercicios' && (
            <div className="stack">
              <div className="alert">✅ A sessão é concluída quando <b>todos os exercícios</b> forem aprovados pelo tutor. Notas ≥ 7 na correção automática aprovam na hora; abaixo disso o tutor decide. Se pedir ajustes, refaça e reenvie quantas vezes precisar.</div>
              {exs.map((e) => <ExerciseBlock key={e.id} ex={e} studentId={studentId} canSubmit={!isTeacher} />)}
            </div>
          )}
          {tab === 'templates' && <div className="stack">{tpls.length ? tpls.map((t) => <TemplateCard key={t.slug} t={t} />) : <Empty>Sem templates nesta sessão.</Empty>}</div>}
          {tab === 'recursos' && <div className="stack">{ress.length ? ress.map((r) => <ResourceCard key={r.slug} r={r} />) : <Empty>Sem recursos nesta sessão.</Empty>}</div>}

          <div className="row between" style={{ marginTop: 20 }}>
            {day > 1 ? <Link className="btn" to={`/sessao/${day - 1}${keep}`}>← Dia {day - 1}</Link> : <span />}
            {day < data.sessions.length && <Link className="btn" to={`/sessao/${day + 1}${keep}`}>Dia {day + 1} →</Link>}
          </div>
        </>
      )}
    </div>
  );
}
