import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { fmtDate, weekday, type ExState } from '../lib/progress';
import type { Exercise } from '../lib/types';
import { ExBadge, Empty, SessBadge } from '../components/ui';
import TemplateCard from '../components/TemplateCard';
import ResourceCard from '../components/ResourceCard';

const TABS = [
  ['conceito', '1 · Conceito'], ['ferramentas', '2 · Ferramentas'], ['exercicios', '3 · Exercícios'], ['templates', '4 · Templates'], ['recursos', '5 · Recursos'],
] as const;

function ExerciseBlock({ ex, studentId, canSubmit }: { ex: Exercise; studentId: string; canSubmit: boolean }) {
  const { progress, reload } = useData();
  const [content, setContent] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const state: ExState = progress.exState(studentId, ex.id);
  const attempts = progress.attempts(studentId, ex.id);
  const waiting = attempts.at(-1)?.status === 'submitted'; // último envio ainda sem avaliação

  const submit = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('submissions').insert({ exercise_id: ex.id, content: content.trim() || null, link_url: link.trim() || null });
    if (error) setErr(error.message); else { setContent(''); setLink(''); await reload(); }
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
                {a.link_url && <div><a href={a.link_url} target="_blank" rel="noreferrer noopener">🔗 {a.link_url}</a></div>}
                {rev ? (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                    <div className="row between"><span className={`badge ${rev.verdict === 'approved' ? 'green' : 'amber'}`}>{rev.verdict === 'approved' ? '✔ Aprovado' : '↩ Ajustes solicitados'}</span><span className="score">{rev.score.toFixed(1)}/10</span></div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>💬 {rev.feedback}</div>
                  </div>
                ) : <div className="small muted" style={{ marginTop: 6 }}>⏳ Aguardando avaliação do tutor…</div>}
              </div>
            );
          })}
        </div>
      )}

      {canSubmit && !waiting && (
        <div>
          <b>{attempts.length === 0 ? 'Enviar entrega' : state === 'approved' ? 'Enviar nova versão (opcional)' : `Refazer entrega · tentativa ${attempts.length + 1}`}</b>
          <label htmlFor={`c-${ex.id}`}>Resposta / explicação</label>
          <textarea id={`c-${ex.id}`} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Descreva o que fez, cole a query, os resultados, suas conclusões…" />
          <label htmlFor={`l-${ex.id}`}>Link do arquivo (OneDrive, Drive, GitHub…) — opcional</label>
          <input id={`l-${ex.id}`} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
          {err && <div className="alert err" style={{ marginTop: 8 }}>{err}</div>}
          <div style={{ marginTop: 10 }}><button className="btn primary" disabled={busy || (!content.trim() && !link.trim())} onClick={submit}>{busy ? 'Enviando…' : attempts.length ? '🔁 Reenviar' : '📤 Enviar para avaliação'}</button></div>
        </div>
      )}
      {canSubmit && waiting && <div className="alert">⏳ Entrega enviada. Aguarde a avaliação do tutor — você poderá refazer se ele solicitar ajustes.</div>}
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
              <div className="alert">✅ A sessão é concluída quando <b>todos os exercícios</b> forem aprovados pelo tutor. Se pedir ajustes, refaça e reenvie quantas vezes precisar.</div>
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
