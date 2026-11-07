import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gradeSubmissions, pendingForAi, type GradeResult } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import { Empty } from '../../components/ui';

type Filter = 'todo' | 'review' | 'done';

export default function Queue() {
  const { data, progress, reload } = useData();
  const { token: tk } = useAuth(); const token = tk ?? '';
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('review');
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const aiOf = (id: string) => data.aiEvaluations.find((e) => e.submission_id === id);

  const refreshPending = useCallback(() => { pendingForAi(token).then(setPending).catch(() => setPending(null)); }, [token]);
  useEffect(() => { refreshPending(); }, [refreshPending, data.submissions]);

  const runAi = async () => {
    setBusy(true); setMsg(null);
    try {
      const r: GradeResult = await gradeSubmissions(token, { limit: 10 });
      setMsg({ kind: r.errors.length ? 'err' : 'ok', text: r.claimed === 0 ? 'Nenhuma entrega aguardando correção.'
        : `${r.claimed} corrigida(s): ${r.auto_approved} aprovada(s) automaticamente, ${r.sent_to_tutor} enviada(s) para sua revisão${r.errors.length ? `, ${r.errors.length} com erro (${r.errors[0].error})` : ''}.` });
      await reload(); setFilter('review');
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
    setBusy(false); refreshPending();
  };

  const items = data.submissions.filter((s) => filter === 'todo' ? s.status === 'submitted' : filter === 'review' ? s.status === 'needs_review' : s.status !== 'submitted' && s.status !== 'needs_review')
    .sort((a, b) => (filter === 'done' ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)));
  const count = (f: Filter) => data.submissions.filter((s) => f === 'todo' ? s.status === 'submitted' : f === 'review' ? s.status === 'needs_review' : false).length;

  const badge = (status: string, score?: number) => {
    const sc = score != null ? ` · ${score.toFixed(1)}` : '';
    if (status === 'submitted') return <span className="badge blue">Aguardando IA</span>;
    if (status === 'needs_review') return <span className="badge amber">Decidir{sc}</span>;
    if (status === 'approved') return <span className="badge green">Aprovada{sc}</span>;
    if (status === 'rejected') return <span className="badge red">Reprovada{sc}</span>;
    return <span className="badge amber">Refazer{sc}</span>;
  };

  return (
    <div className="stack">
      <div className="row between">
        <div><h1>📝 Fila de avaliação</h1>
          <p className="muted">A IA corrige as entregas: <b>nota ≥ 7 aprova sozinha</b>; abaixo disso a entrega vem para você decidir (aprovar, pedir que refaça com instruções e exemplo, ou reprovar).</p></div>
        <button className="btn primary" disabled={busy || pending === 0} onClick={runAi}>{busy ? '🤖 Corrigindo…' : `🤖 Corrigir com IA${pending ? ` (${pending})` : ''}`}</button>
      </div>
      {msg && <div className={`alert ${msg.kind === 'ok' ? 'ok' : 'err'}`} role="status">{msg.text}</div>}
      <div className="segmented" role="tablist">
        <button className="btn sm" aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>🔎 Para decidir ({count('review')})</button>
        <button className="btn sm" aria-pressed={filter === 'todo'} onClick={() => setFilter('todo')}>⏳ Aguardando IA ({count('todo')})</button>
        <button className="btn sm" aria-pressed={filter === 'done'} onClick={() => setFilter('done')}>✔ Já decididas</button>
      </div>
      {items.length === 0 ? <Empty>{filter === 'review' ? 'Nada para decidir 🎉' : filter === 'todo' ? 'Nenhuma entrega aguardando a IA.' : 'Nada decidido ainda.'}</Empty> : (
        <div className="card scroll-x"><table><thead><tr><th>Aluno</th><th>Sessão / exercício</th><th>Tentativa</th><th>Enviada</th><th>IA</th><th>Status</th></tr></thead><tbody>
          {items.map((s) => {
            const ex = data.exercises.find((e) => e.id === s.exercise_id)!, st = data.profiles.find((p) => p.id === s.student_id);
            const rev = progress.reviewOf(s.id), ai = aiOf(s.id);
            return (
              <tr key={s.id} className="click" onClick={() => nav(`/tutor/avaliar/${s.id}`)}>
                <td><b>{st?.full_name ?? st?.email}</b></td>
                <td>Dia {ex.session_day} · {ex.title}</td><td>#{s.attempt}</td><td>{fmtDate(s.created_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{ai?.status === 'done' && ai.score != null ? <span title={ai.outcome_reason ?? ''}>🤖 {Number(ai.score).toFixed(1)}</span> : ai?.status === 'error' ? <span className="badge red" title={ai.error ?? ''}>erro</span> : <span className="muted">—</span>}</td>
                <td>{badge(s.status, rev?.score)}{rev?.source === 'ai' && <span className="small muted"> 🤖</span>}</td>
              </tr>
            );
          })}
        </tbody></table></div>
      )}
      <Link to="/tutor">← Visão da turma</Link>
    </div>
  );
}
