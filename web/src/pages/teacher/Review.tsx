import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import { Empty } from '../../components/ui';

export default function Review() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, progress, reload } = useData();
  const sub = data.submissions.find((s) => s.id === id);
  const existing = sub ? progress.reviewOf(sub.id) : undefined;
  const [score, setScore] = useState<number>(existing?.score ?? 8);
  const [feedback, setFeedback] = useState(existing?.feedback ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!sub) return <Empty>Entrega não encontrada. <Link to="/tutor/fila">Voltar</Link></Empty>;
  const ex = data.exercises.find((e) => e.id === sub.exercise_id)!, sess = data.sessions.find((s) => s.day === ex.session_day)!;
  const student = data.profiles.find((p) => p.id === sub.student_id);
  const history = progress.attempts(sub.student_id, sub.exercise_id);

  const save = async (verdict: 'approved' | 'revision_requested') => {
    if (!feedback.trim()) { setErr('Escreva um feedback para o aluno.'); return; }
    setBusy(true); setErr('');
    const payload = { score, verdict, feedback: feedback.trim() };
    const { error } = existing
      ? await supabase.from('reviews').update(payload).eq('id', existing.id)
      : await supabase.from('reviews').insert({ submission_id: sub.id, ...payload });
    if (error) { setErr(error.message); setBusy(false); return; }
    await reload(); setBusy(false); nav('/tutor/fila');
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
          <Link className="btn sm" to={`/sessao/${sess.day}?aluno=${sub.student_id}&tab=exercicios`}>Ver sessão como o aluno</Link>
        </div>
        <div className="card stack">
          <h2>Avaliação</h2>
          <div className="alert">Critérios: correção dos números (35%) · raciocínio de negócio (25%) · técnica (20%) · visual (10%) · reprodutibilidade (10%). <b>Nota ≥ 7</b> = aprovado.</div>
          <div><label htmlFor="score">Nota: <b>{score.toFixed(1)}</b> / 10</label>
            <input id="score" type="range" min={0} max={10} step={0.5} value={score} onChange={(e) => setScore(Number(e.target.value))} style={{ width: '100%' }} /></div>
          <div><label htmlFor="fb">Feedback para o aluno</label><textarea id="fb" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="O que está bom, o que ajustar, próximos passos…" /></div>
          {err && <div className="alert err">{err}</div>}
          <div className="row">
            <button className="btn good" disabled={busy} onClick={() => save('approved')}>✔ Aprovar</button>
            <button className="btn warn" disabled={busy} onClick={() => save('revision_requested')}>↩ Solicitar ajustes</button>
          </div>
          {existing && <div className="small muted">Esta entrega já foi avaliada; salvar atualiza a avaliação.</div>}
          {history.length > 1 && <div><b className="small muted">Tentativas anteriores</b>{history.filter((h) => h.id !== sub.id).map((h) => <div key={h.id} className="attempt">#{h.attempt} · {h.status}{progress.reviewOf(h.id) ? ` · nota ${progress.reviewOf(h.id)!.score}` : ''}</div>)}</div>}
        </div>
      </div>
    </div>
  );
}
