import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import { Empty } from '../../components/ui';

export default function Queue() {
  const { data, progress } = useData();
  const nav = useNavigate();
  const [showDone, setShowDone] = useState(false);
  const items = data.submissions.filter((s) => showDone || s.status === 'submitted').sort((a, b) => (showDone ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)));
  return (
    <div className="stack">
      <div className="row between"><div><h1>📝 Fila de avaliação</h1><p className="muted">Mais antigas primeiro. Aprove ou solicite ajustes com feedback.</p></div>
        <label className="row" style={{ margin: 0 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Mostrar já avaliadas</label></div>
      {items.length === 0 ? <Empty>Nada pendente 🎉</Empty> : (
        <div className="card scroll-x"><table><thead><tr><th>Aluno</th><th>Sessão / exercício</th><th>Tentativa</th><th>Enviada</th><th>Status</th></tr></thead><tbody>
          {items.map((s) => {
            const ex = data.exercises.find((e) => e.id === s.exercise_id)!, st = data.profiles.find((p) => p.id === s.student_id);
            const rev = progress.reviewOf(s.id);
            return (
              <tr key={s.id} className="click" onClick={() => nav(`/tutor/avaliar/${s.id}`)}>
                <td><b>{st?.full_name ?? st?.email}</b></td>
                <td>Dia {ex.session_day} · {ex.title}</td><td>#{s.attempt}</td><td>{fmtDate(s.created_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{s.status === 'submitted' ? <span className="badge blue">Avaliar</span> : <span className={`badge ${s.status === 'approved' ? 'green' : 'amber'}`}>{s.status === 'approved' ? 'Aprovada' : 'Ajustes'}{rev ? ` · ${rev.score.toFixed(1)}` : ''}</span>}</td>
              </tr>
            );
          })}
        </tbody></table></div>
      )}
      <Link to="/tutor">← Visão da turma</Link>
    </div>
  );
}
