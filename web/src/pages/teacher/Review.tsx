import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, gradeSubmissions } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import { Empty } from '../../components/ui';
import type { Verdict } from '../../lib/types';

const DIM: Record<string, string> = { num: 'Números', neg: 'Negócio', tec: 'Técnica', vis: 'Visual', rep: 'Reprodutib.' };
const REASON: Record<string, string> = {
  score_below_pass: 'Nota abaixo de 7', insufficient_evidence: 'Evidência insuficiente (a IA não abre links/arquivos)', low_confidence: 'IA com baixa confiança',
  suspected_manipulation: 'Possível tentativa de manipular a correção', tutor_only_exercise: 'Etapa avaliada só pelo tutor', file_requires_tutor: 'Pré-análise de arquivo: a decisão final é sua', score_at_or_above_pass: 'Nota ≥ 7', already_decided: 'Já decidida pelo tutor',
};
const VERDICT_LABEL: Record<Verdict, string> = { approved: 'Aprovar', revision_requested: 'Pedir que refaça', rejected: 'Reprovar' };

export default function Review() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, progress, reload } = useData();
  const { token: tk } = useAuth(); const token = tk ?? '';
  const sub = data.submissions.find((s) => s.id === id);
  const existing = sub ? progress.reviewOf(sub.id) : undefined;
  const ai = sub ? data.aiEvaluations.find((e) => e.submission_id === sub.id && e.status === 'done') : undefined;
  const rubric = sub ? data.rubrics.find((r) => r.exercise_id === sub.exercise_id) : undefined;
  const [score, setScore] = useState<number>(existing?.score ?? (ai?.score != null ? Math.round(Number(ai.score) * 2) / 2 : 6));
  const [mode, setMode] = useState<Verdict | null>(existing?.verdict ?? null);
  const [feedback, setFeedback] = useState(existing?.feedback ?? '');
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const [examples, setExamples] = useState(existing?.examples ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!sub) return <Empty>Entrega não encontrada. <Link to="/tutor/fila">Voltar</Link></Empty>;
  const ex = data.exercises.find((e) => e.id === sub.exercise_id)!, sess = data.sessions.find((s) => s.day === ex.session_day)!;
  const student = data.profiles.find((p) => p.id === sub.student_id);
  const history = progress.attempts(sub.student_id, sub.exercise_id);
  const waitingAi = sub.status === 'submitted';

  const pick = (v: Verdict) => {
    setMode(v);
    if (v === 'approved' && score < 7) setScore(7);
    if (v === 'revision_requested' && score >= 7) setScore(6);
    if (v === 'rejected' && score >= 7) setScore(3);
  };
  const useAiDraft = () => {
    if (!ai) return;
    setFeedback((f) => f || ai.summary || '');
    setInstructions((f) => f || ai.suggested_instructions || '');
    setExamples((f) => f || ai.suggested_examples || '');
  };
  const runAiNow = async () => {
    setBusy(true); setErr('');
    try { await gradeSubmissions(token, { submission_ids: [sub.id] }); await reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const save = async () => {
    if (!mode) { setErr('Escolha a decisão: aprovar, pedir que refaça ou reprovar.'); return; }
    if (!feedback.trim()) { setErr(mode === 'rejected' ? 'Explique o motivo da reprovação.' : 'Escreva um feedback para o aluno.'); return; }
    if (mode === 'revision_requested' && (!instructions.trim() || !examples.trim())) { setErr('Para pedir que o aluno refaça, preencha as instruções e um exemplo de como refazer.'); return; }
    setBusy(true); setErr('');
    try {
      await api('app_review', { p_token: token, p_submission_id: sub.id, p_score: score, p_verdict: mode, p_feedback: feedback.trim(),
        p_instructions: mode === 'revision_requested' ? instructions.trim() : null, p_examples: mode === 'revision_requested' ? examples.trim() : null });
      await reload(); nav('/tutor/fila');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="stack">
      <div className="small"><Link to="/tutor/fila">← Fila</Link></div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <div><span className="badge blue">Dia {sess.day} · {sess.title}</span><h2 style={{ margin: '8px 0 2px' }}>{ex.title}</h2>
            <div className="small muted">Aluno: <Link to={`/tutor/alunos/${sub.student_id}`}>{student?.full_name}</Link> · tentativa #{sub.attempt} · {fmtDate(sub.created_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
          <div><b>Enunciado</b><p>{ex.instructions}</p><div className="small"><b>📎 Entregável esperado:</b> {ex.deliverable}</div></div>
          <div className="attempt submitted">
            <b>Entrega do aluno</b>
            {sub.content && <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{sub.content}</div>}
            {sub.link_url && <div style={{ marginTop: 6 }}><a href={sub.link_url} target="_blank" rel="noreferrer noopener">🔗 {sub.link_url}</a></div>}
          </div>
          {rubric && (
            <details>
              <summary><b>✅ Solução esperada (gabarito)</b> <span className="badge">{rubric.mode}</span></summary>
              <p>{rubric.expected}</p>
              {rubric.grading_notes && <div className="alert">{rubric.grading_notes}</div>}
              {rubric.checks.map((c) => <div key={c.id} className="crit"><span>{c.label}</span><span className="small muted">{c.weight}% · {DIM[c.dim]}</span></div>)}
            </details>
          )}
          <Link className="btn sm" to={`/sessao/${sess.day}?aluno=${sub.student_id}&tab=exercicios`}>Ver sessão como o aluno</Link>
        </div>

        <div className="stack">
          <div className="card stack">
            <div className="row between"><h2 style={{ margin: 0 }}>🤖 Correção da IA</h2>
              {(waitingAi || !ai) && <button className="btn sm primary" disabled={busy || !waitingAi} onClick={runAiNow}>{busy ? 'Corrigindo…' : 'Corrigir agora'}</button>}</div>
            {!ai ? <div className="muted">{waitingAi ? 'Ainda não corrigida pela IA. Você pode acionar agora ou decidir manualmente.' : 'Sem análise da IA para esta entrega.'}</div> : (<>
              <div className="row between">
                <span className="score" style={{ fontSize: '1.6rem' }}>{Number(ai.score).toFixed(1)}<span className="muted small"> / 10</span></span>
                <span className={`badge ${ai.outcome === 'auto_approved' ? 'green' : 'amber'}`}>{ai.outcome === 'auto_approved' ? 'Aprovada automaticamente' : `Enviada ao tutor · ${REASON[ai.outcome_reason ?? ''] ?? ai.outcome_reason}`}</span>
              </div>
              <div className="small muted">Confiança: {ai.confidence === 'high' ? 'alta' : ai.confidence === 'medium' ? 'média' : 'baixa'} · evidência {ai.evidence_sufficient ? 'suficiente' : 'insuficiente'}{ai.suspected_manipulation ? ' · ⚠️ possível manipulação' : ''} · {ai.model}</div>
              {!!ai.attachments?.length && (
                <div className="small"><b>📎 Arquivos/links:</b> {ai.attachments.map((a, i) => (
                  <span key={i} className={`badge ${a.status === 'read' ? 'green' : 'amber'}`} style={{ marginRight: 6 }} title={a.detail ?? a.source}>{a.status === 'read' ? `lido · ${a.kind}${a.truncated ? ' (truncado)' : ''}` : `não lido · ${a.detail}`}</span>))}</div>
              )}
              <p style={{ margin: 0 }}>{ai.summary}</p>
              {ai.criteria?.map((c) => <div key={c.id} className="crit"><span>{c.label}<div className="small muted">{c.comment}</div></span><b>{Number(c.score).toFixed(1)}</b></div>)}
              {!!ai.strengths?.length && <div><b className="small">Pontos fortes</b><ul>{ai.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              {!!ai.gaps?.length && <div><b className="small">Lacunas</b><ul>{ai.gaps.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              <div className="small muted">A análise da IA é apoio: o aluno só a vê se a entrega foi aprovada automaticamente.</div>
            </>)}
          </div>

          <div className="card stack">
            <h2 style={{ margin: 0 }}>Sua decisão</h2>
            <div className="segmented" role="group" aria-label="Decisão">
              {(['approved', 'revision_requested', 'rejected'] as Verdict[]).map((v) => (
                <button key={v} className={`btn sm ${mode === v ? (v === 'approved' ? 'good' : v === 'rejected' ? 'bad' : 'warn') : ''}`} aria-pressed={mode === v} onClick={() => pick(v)}>
                  {v === 'approved' ? '✔' : v === 'revision_requested' ? '↩' : '✖'} {VERDICT_LABEL[v]}
                </button>
              ))}
            </div>
            <div><label htmlFor="score">Nota: <b>{score.toFixed(1)}</b> / 10</label>
              <input id="score" type="range" min={0} max={10} step={0.5} value={score} onChange={(e) => setScore(Number(e.target.value))} style={{ width: '100%' }} /></div>
            <div><label htmlFor="fb">{mode === 'rejected' ? 'Motivo da reprovação (o aluno verá)' : 'Feedback para o aluno'}</label>
              <textarea id="fb" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={mode === 'rejected' ? 'Por que a entrega foi reprovada…' : 'O que está bom, o que ajustar…'} /></div>
            {mode === 'revision_requested' && (<>
              <div><label htmlFor="ins">📋 Instruções de como refazer <span className="muted small">(obrigatório)</span></label>
                <textarea id="ins" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Passo a passo do que o aluno deve ajustar…" /></div>
              <div><label htmlFor="exa">💡 Exemplo <span className="muted small">(obrigatório)</span></label>
                <textarea id="exa" value={examples} onChange={(e) => setExamples(e.target.value)} placeholder="Um exemplo curto de como deveria ficar…" /></div>
            </>)}
            {ai && <button className="btn sm" onClick={useAiDraft} title="Preenche os campos vazios com a sugestão da IA; revise antes de enviar">✨ Usar rascunho da IA</button>}
            {err && <div className="alert err">{err}</div>}
            <div className="row"><button className="btn primary" disabled={busy || !mode} onClick={save}>{busy ? 'Salvando…' : 'Salvar e avisar o aluno'}</button></div>
            <div className="small muted">O aluno é notificado em qualquer decisão. {existing && 'Esta entrega já foi avaliada; salvar atualiza a avaliação e avisa o aluno novamente.'}</div>
            {history.length > 1 && <div><b className="small muted">Tentativas anteriores</b>{history.filter((h) => h.id !== sub.id).map((h) => <div key={h.id} className="attempt">#{h.attempt} · {h.status}{progress.reviewOf(h.id) ? ` · nota ${progress.reviewOf(h.id)!.score}` : ''}</div>)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
